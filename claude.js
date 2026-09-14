/* Claude API layer. Shared verbatim between the browser app and the node test
   harness so the two can never drift. Classic script in the browser
   (window.RTClaude), CommonJS in node. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RTClaude = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ENDPOINT = 'https://api.anthropic.com/v1/messages';
  var MODELS_ENDPOINT = 'https://api.anthropic.com/v1/models';
  var VERSION = '2023-06-01';

  /* USD per million tokens, from the pricing table in the claude-api skill.
     Only used to show the person what a run cost, never to make decisions. */
  var PRICING = {
    'claude-opus-5': { input: 5, output: 25 },
    'claude-sonnet-5': { input: 2, output: 10 },
    'claude-haiku-4-5': { input: 1, output: 5 }
  };

  function headers(key) {
    return {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': VERSION,
      // Harmless from node; required for the browser to be allowed to call at all.
      'anthropic-dangerous-direct-browser-access': 'true'
    };
  }

  function cost(model, usage) {
    var p = PRICING[model];
    if (!p || !usage) return 0;
    return (usage.input_tokens || 0) / 1e6 * p.input
      + (usage.output_tokens || 0) / 1e6 * p.output;
  }

  function money(n) {
    return n < 0.01 ? '<$0.01' : '$' + n.toFixed(n < 1 ? 3 : 2);
  }

  /* Free: counts tokens without generating. Worth calling before an expensive
     run so the person can see what they are about to spend. */
  function countTokens(key, body) {
    var payload = {
      model: body.model,
      messages: body.messages
    };
    if (body.system) payload.system = body.system;
    return fetch('https://api.anthropic.com/v1/messages/count_tokens', {
      method: 'POST',
      headers: headers(key),
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().then(function (j) {
        if (!res.ok) throw apiError(res.status, j);
        return j.input_tokens;
      });
    });
  }

  /* Free: authenticates without generating. Used to check a key costs nothing. */
  function listModels(key) {
    return fetch(MODELS_ENDPOINT + '?limit=100', { headers: headers(key) })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          if (!res.ok) throw apiError(res.status, j);
          return (j.data || []).map(function (m) { return m.id; });
        });
      });
  }

  function apiError(status, body) {
    var message = body && body.error && body.error.message ? body.error.message : ('HTTP ' + status);
    var err = new Error(message);
    err.status = status;
    err.retryable = status === 429 || status >= 500;
    if (status === 401) err.message = 'Your API key was rejected.';
    if (status === 403) err.message = 'That key does not have access to this model.';
    if (status === 429) err.message = 'Rate limited. Waiting and trying again.';
    return err;
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  /* Always stream. These calls think for a minute or more, and a non-streaming
     request that long gets its socket closed underneath it (UND_ERR_SOCKET in
     node, a stalled request in the browser). Streaming also lets the UI show
     progress instead of freezing. One code path so the two cannot drift.

     onProgress, if given, is called with the accumulated text so far. */
  function send(key, body, onProgress, attempt) {
    attempt = attempt || 0;
    var streaming = Object.assign({}, body, { stream: true });

    return fetch(ENDPOINT, {
      method: 'POST',
      headers: headers(key),
      body: JSON.stringify(streaming)
    }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          var err = apiError(res.status, j);
          if (err.retryable && attempt < 3) {
            return sleep(Math.pow(2, attempt) * 1500).then(function () {
              return send(key, body, onProgress, attempt + 1);
            });
          }
          throw err;
        });
      }
      return readStream(res, onProgress);
    }, function (networkErr) {
      if (attempt < 2) {
        return sleep(Math.pow(2, attempt) * 1500).then(function () {
          return send(key, body, onProgress, attempt + 1);
        });
      }
      // node wraps the real reason in .cause; without it every failure reads
      // as an unhelpful "fetch failed".
      var why = networkErr.cause ? (networkErr.cause.code || networkErr.cause.message) : networkErr.message;
      throw new Error('Could not reach the API: ' + why);
    });
  }

  /* Reassemble the server-sent events into the same message shape a
     non-streaming call returns, so callers never care which was used. */
  function readStream(res, onProgress) {
    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var text = '';
    var message = { content: [], stop_reason: null, stop_details: null, usage: {} };

    function handle(payload) {
      var evt;
      try { evt = JSON.parse(payload); } catch (e) { return; }

      if (evt.type === 'message_start' && evt.message) {
        message.model = evt.message.model;
        message.usage = Object.assign({}, evt.message.usage);
      } else if (evt.type === 'content_block_delta' && evt.delta && evt.delta.type === 'text_delta') {
        text += evt.delta.text;
        if (onProgress) onProgress(text);
      } else if (evt.type === 'message_delta') {
        if (evt.delta) {
          if (evt.delta.stop_reason) message.stop_reason = evt.delta.stop_reason;
          if (evt.delta.stop_details) message.stop_details = evt.delta.stop_details;
        }
        if (evt.usage) message.usage = Object.assign(message.usage, evt.usage);
      } else if (evt.type === 'error') {
        var e = new Error(evt.error && evt.error.message ? evt.error.message : 'Stream failed.');
        e.midStream = true;
        throw e;
      }
    }

    function pump() {
      return reader.read().then(function (chunk) {
        if (chunk.done) {
          message.content = [{ type: 'text', text: text }];
          return message;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        // Events are separated by a blank line; keep any partial tail.
        var parts = buffer.split('\n\n');
        buffer = parts.pop();
        parts.forEach(function (block) {
          block.split('\n').forEach(function (line) {
            if (line.indexOf('data:') === 0) handle(line.slice(5).trim());
          });
        });
        return pump();
      });
    }

    return pump();
  }

  /* Structured output arrives as JSON in the text blocks. Thinking blocks may
     come first, so take the text ones and parse those. */
  function readJson(message) {
    if (message.stop_reason === 'refusal') {
      var why = message.stop_details && message.stop_details.explanation;
      throw new Error('Claude declined this request' + (why ? ': ' + why : '.'));
    }
    var text = (message.content || [])
      .filter(function (b) { return b.type === 'text'; })
      .map(function (b) { return b.text; })
      .join('');
    if (!text.trim()) {
      throw new Error('Claude returned nothing usable (stop reason: ' + message.stop_reason + ').');
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      // Only reachable if the schema was not enforced; keep the text for debugging.
      var err = new Error('Claude returned text that is not valid JSON.');
      err.raw = text.slice(0, 2000);
      throw err;
    }
  }

  /* -------------------------------------------------------------- schemas */

  var ROLE_CODES = ['DA', 'DE', 'DS', 'MLE', 'AI'];

  var EXTRACT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['basics', 'skills', 'sections', 'parseReview'],
    properties: {
      basics: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'email', 'phone', 'city', 'state', 'linkedin', 'portfolio'],
        properties: {
          name: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string' },
          linkedin: { type: 'string' },
          portfolio: { type: 'string' }
        }
      },
      summary: { type: ['string', 'null'], description: 'The resume\'s own summary or objective, word for word. Null if it has none.' },
      skills: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['group', 'items'],
          properties: {
            group: { type: 'string' },
            items: { type: 'array', items: { type: 'string' } }
          }
        }
      },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'title', 'items'],
          properties: {
            kind: { type: 'string', enum: ['experience', 'projects', 'education', 'skills', 'certifications', 'other'] },
            title: { type: 'string' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['heading', 'subheading', 'dateStart', 'dateEnd', 'bullets'],
                properties: {
                  heading: { type: 'string', description: 'Role title, degree, or project name.' },
                  subheading: { type: 'string', description: 'Employer, institution, or context. Empty string if none.' },
                  dateStart: { type: 'string', description: 'MM/YYYY, or empty string.' },
                  dateEnd: { type: 'string', description: 'MM/YYYY or Present, or empty string.' },
                  bullets: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['text', 'tags', 'roles', 'numbers'],
                      properties: {
                        text: { type: 'string', description: 'Word for word from the resume.' },
                        tags: { type: 'array', items: { type: 'string' } },
                        roles: { type: 'array', items: { type: 'string', enum: ROLE_CODES } },
                        numbers: {
                          type: 'array',
                          items: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['value', 'what'],
                            properties: {
                              value: { type: 'string' },
                              what: { type: 'string', description: 'What the number measures, in a few words.' }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      parseReview: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['field', 'note'],
          properties: {
            field: { type: 'string', description: 'Short label for what is uncertain, e.g. phone, dates, spelling.' },
            note: { type: 'string', description: 'One sentence the person can act on.' }
          }
        }
      }
    }
  };

  var ANALYSE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['role', 'shape', 'requirements', 'predicted', 'gaps', 'adInstructions'],
    properties: {
      role: { type: 'string', enum: ROLE_CODES },
      shape: { type: 'string', description: 'One sentence on what the ad actually reads like.' },
      requirements: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'category', 'weight', 'required', 'adCount', 'aliases', 'status', 'evidence'],
          properties: {
            name: { type: 'string' },
            category: { type: 'string', enum: ['hard-skill', 'tool', 'cert', 'soft-skill', 'title', 'years', 'qualification'] },
            // Structured outputs reject minimum/maximum on integers, so the
            // ranges live in the description and the prompt instead.
            weight: { type: 'integer', description: '1 to 10. How much this matters to this employer.' },
            required: { type: 'boolean' },
            adCount: { type: 'integer', description: 'How many times the ad mentions it, counting synonyms.' },
            aliases: { type: 'array', items: { type: 'string' } },
            status: { type: 'string', enum: ['evidenced', 'partial', 'missing'] },
            evidence: { type: 'array', items: { type: 'string' }, description: 'Bullet ids that carry the evidence.' }
          }
        }
      },
      predicted: { type: 'array', items: { type: 'string' } },
      gaps: {
        type: 'array',
        description: 'At most five questions, hardest first by weight.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['requirement', 'question'],
          properties: {
            requirement: { type: 'string' },
            question: { type: 'string' }
          }
        }
      },
      adInstructions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['instruction', 'quote'],
          properties: {
            instruction: { type: 'string' },
            quote: { type: 'string' }
          }
        }
      }
    }
  };

  /* ------------------------------------------------------------- requests */

  function baseBody(model, effort, maxTokens) {
    var body = {
      model: model,
      max_tokens: maxTokens || 16000,
      output_config: { effort: effort || 'high' }
    };
    // Opus 5 thinks by default; naming it adaptive is explicit and harmless.
    body.thinking = { type: 'adaptive' };
    return body;
  }

  function extractRequest(opts) {
    var prompts = opts.prompts;
    var body = baseBody(opts.model, opts.effort, 16000);
    body.system = prompts.EXTRACT;
    body.output_config.format = { type: 'json_schema', schema: EXTRACT_SCHEMA };

    var content = [];
    if (opts.pdfBase64) {
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: opts.pdfBase64 }
      });
    }
    content.push({
      type: 'text',
      text: 'Extract this resume into the inventory structure. The person is at '
        + (opts.careerStage || 'junior') + ' career stage.'
        // Without today's date the model flags any recent start date as
        // suspiciously "in the future" and wastes a parse-review slot on it.
        + '\n\nToday is ' + (opts.today || new Date().toISOString().slice(0, 10)) + '.'
        + (opts.resumeText ? '\n\nResume text:\n\n' + opts.resumeText : '')
    });
    body.messages = [{ role: 'user', content: content }];
    return body;
  }

  function analyseRequest(opts) {
    var prompts = opts.prompts;
    var body = baseBody(opts.model, opts.effort, 16000);
    body.system = prompts.ANALYSE;
    body.output_config.format = { type: 'json_schema', schema: ANALYSE_SCHEMA };
    body.messages = [{
      role: 'user',
      content: 'Here is the person\'s bullet inventory, one line per bullet as "id: text":\n\n'
        + opts.inventory
        + '\n\nAnd their skills list:\n\n' + opts.skills
        + '\n\nHere is the job ad:\n\n' + opts.adText
    }];
    return body;
  }

  return {
    PRICING: PRICING,
    ROLE_CODES: ROLE_CODES,
    EXTRACT_SCHEMA: EXTRACT_SCHEMA,
    ANALYSE_SCHEMA: ANALYSE_SCHEMA,
    headers: headers,
    cost: cost,
    money: money,
    countTokens: countTokens,
    listModels: listModels,
    send: send,
    readJson: readJson,
    extractRequest: extractRequest,
    analyseRequest: analyseRequest
  };
});
