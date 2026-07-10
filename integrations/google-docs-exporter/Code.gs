const DEFAULT_DOCUMENT_ID = '101FjJy7Q0gT4XSAlcOmXX0WbqbMh0W3Q9B0fUgtfZkU';
const ALLOWED_DECISIONS = ['Soft approve', 'Strongly approved', 'Soft Decline', 'Declined'];
const MAX_REPORT_CHARS = 100000;

function doGet() {
  return jsonResponse_({
    ok: true,
    service: 'sensei-google-docs-exporter',
    version: '1.0.0'
  });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);

    const payload = parsePayload_(e);
    validateSecret_(payload.sharedSecret);
    validatePayload_(payload);

    const documentId = getConfig_('TARGET_DOCUMENT_ID', DEFAULT_DOCUMENT_ID);
    const requestedTitle = `${payload.projectName.trim()} ${payload.evaluationType}`;
    const document = getDocument_(documentId);
    const existingTabs = flattenTabs_(document.tabs || []);
    const uniqueTitle = makeUniqueTitle_(requestedTitle, existingTabs.map(tab => tab.tabProperties.title));

    createTab_(documentId, uniqueTitle);

    const refreshedDocument = getDocument_(documentId);
    const newTab = flattenTabs_(refreshedDocument.tabs || [])
      .find(tab => tab.tabProperties.title === uniqueTitle);

    if (!newTab) {
      throw new Error('The new Google Docs tab was created but could not be resolved.');
    }

    const parsed = parseMarkdown_(payload.reportMarkdown);
    writeReportToTab_(documentId, newTab.tabProperties.tabId, parsed);

    const tabUrl = `https://docs.google.com/document/d/${documentId}/edit?tab=${encodeURIComponent(newTab.tabProperties.tabId)}`;

    return jsonResponse_({
      ok: true,
      projectName: payload.projectName.trim(),
      evaluationType: payload.evaluationType,
      decision: payload.decision,
      tabTitle: uniqueTitle,
      tabId: newTab.tabProperties.tabId,
      documentId,
      documentUrl: tabUrl
    });
  } catch (error) {
    console.error(error);
    return jsonResponse_({
      ok: false,
      error: error && error.message ? error.message : String(error)
    });
  } finally {
    try {
      lock.releaseLock();
    } catch (_) {}
  }
}

function parsePayload_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error('Missing JSON request body.');
  }

  try {
    return JSON.parse(e.postData.contents);
  } catch (_) {
    throw new Error('Request body must be valid JSON.');
  }
}

function validateSecret_(providedSecret) {
  const expectedSecret = PropertiesService.getScriptProperties().getProperty('EXPORTER_SHARED_SECRET');
  if (!expectedSecret) {
    throw new Error('Server configuration is incomplete: EXPORTER_SHARED_SECRET is not set.');
  }

  if (!providedSecret || !constantTimeEquals_(String(providedSecret), expectedSecret)) {
    throw new Error('Unauthorized request.');
  }
}

function validatePayload_(payload) {
  const required = ['projectName', 'evaluationType', 'decision', 'reportMarkdown'];
  required.forEach(field => {
    if (!payload[field] || typeof payload[field] !== 'string') {
      throw new Error(`Missing or invalid field: ${field}`);
    }
  });

  if (!['L1', 'L2'].includes(payload.evaluationType)) {
    throw new Error('evaluationType must be L1 or L2.');
  }

  if (!ALLOWED_DECISIONS.includes(payload.decision)) {
    throw new Error(`decision must be one of: ${ALLOWED_DECISIONS.join(', ')}.`);
  }

  if (payload.projectName.trim().length > 120) {
    throw new Error('projectName is too long.');
  }

  if (payload.reportMarkdown.length > MAX_REPORT_CHARS) {
    throw new Error(`reportMarkdown exceeds the ${MAX_REPORT_CHARS}-character limit.`);
  }
}

function getConfig_(key, fallback) {
  return PropertiesService.getScriptProperties().getProperty(key) || fallback;
}

function getDocument_(documentId) {
  return docsApiRequest_('get', `/v1/documents/${encodeURIComponent(documentId)}?includeTabsContent=true`);
}

function createTab_(documentId, title) {
  docsApiRequest_('post', `/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`, {
    requests: [{
      addDocumentTab: {
        tabProperties: { title }
      }
    }]
  });
}

function writeReportToTab_(documentId, tabId, parsed) {
  const requests = [{
    insertText: {
      text: parsed.text,
      location: {
        index: 1,
        tabId
      }
    }
  }];

  parsed.headings.forEach(heading => {
    requests.push({
      updateParagraphStyle: {
        range: {
          startIndex: heading.startIndex,
          endIndex: heading.endIndex,
          tabId
        },
        paragraphStyle: {
          namedStyleType: heading.namedStyleType
        },
        fields: 'namedStyleType'
      }
    });
  });

  parsed.boldRanges.forEach(range => {
    requests.push({
      updateTextStyle: {
        range: {
          startIndex: range.startIndex,
          endIndex: range.endIndex,
          tabId
        },
        textStyle: {
          bold: true
        },
        fields: 'bold'
      }
    });
  });

  parsed.links.forEach(link => {
    requests.push({
      updateTextStyle: {
        range: {
          startIndex: link.startIndex,
          endIndex: link.endIndex,
          tabId
        },
        textStyle: {
          link: { url: link.url }
        },
        fields: 'link'
      }
    });
  });

  const chunkSize = 80;
  for (let i = 0; i < requests.length; i += chunkSize) {
    docsApiRequest_('post', `/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`, {
      requests: requests.slice(i, i + chunkSize)
    });
  }
}

function parseMarkdown_(markdown) {
  const lines = String(markdown)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');

  const outputLines = [];
  const headings = [];
  const boldRanges = [];
  const links = [];
  let cursor = 1;
  let inFence = false;

  lines.forEach(line => {
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      return;
    }

    let headingLevel = 0;
    let working = line;

    if (!inFence) {
      const headingMatch = working.match(/^(#{1,3})\s+(.*)$/);
      if (headingMatch) {
        headingLevel = headingMatch[1].length;
        working = headingMatch[2];
      }
    }

    const parsedInline = parseInlineMarkdown_(working, cursor);
    outputLines.push(parsedInline.text);
    boldRanges.push(...parsedInline.boldRanges);
    links.push(...parsedInline.links);

    const lineEnd = cursor + parsedInline.text.length;
    if (headingLevel > 0 && parsedInline.text.length > 0) {
      headings.push({
        startIndex: cursor,
        endIndex: lineEnd + 1,
        namedStyleType: headingLevel === 1 ? 'TITLE' : headingLevel === 2 ? 'HEADING_1' : 'HEADING_2'
      });
    }

    cursor = lineEnd + 1;
  });

  let text = outputLines.join('\n');
  if (!text.endsWith('\n')) {
    text += '\n';
  }

  return { text, headings, boldRanges, links };
}

function parseInlineMarkdown_(input, absoluteStartIndex) {
  let text = '';
  const boldRanges = [];
  const links = [];
  let i = 0;

  while (i < input.length) {
    if (input.startsWith('**', i)) {
      const close = input.indexOf('**', i + 2);
      if (close !== -1) {
        const inner = input.slice(i + 2, close);
        const startIndex = absoluteStartIndex + text.length;
        text += inner;
        boldRanges.push({ startIndex, endIndex: startIndex + inner.length });
        i = close + 2;
        continue;
      }
    }

    if (input[i] === '[') {
      const closeBracket = input.indexOf('](', i + 1);
      if (closeBracket !== -1) {
        const closeParen = input.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          const label = input.slice(i + 1, closeBracket);
          const url = input.slice(closeBracket + 2, closeParen);
          if (/^https?:\/\//i.test(url)) {
            const startIndex = absoluteStartIndex + text.length;
            text += label;
            links.push({ startIndex, endIndex: startIndex + label.length, url });
            i = closeParen + 1;
            continue;
          }
        }
      }
    }

    text += input[i];
    i += 1;
  }

  return { text, boldRanges, links };
}

function flattenTabs_(tabs) {
  const result = [];
  (tabs || []).forEach(tab => {
    result.push(tab);
    if (tab.childTabs && tab.childTabs.length) {
      result.push(...flattenTabs_(tab.childTabs));
    }
  });
  return result;
}

function makeUniqueTitle_(requestedTitle, existingTitles) {
  const normalized = new Set(existingTitles.map(title => String(title).trim().toLowerCase()));
  if (!normalized.has(requestedTitle.toLowerCase())) {
    return requestedTitle;
  }

  let suffix = 2;
  while (normalized.has(`${requestedTitle} - ${suffix}`.toLowerCase())) {
    suffix += 1;
  }
  return `${requestedTitle} - ${suffix}`;
}

function docsApiRequest_(method, path, payload) {
  const options = {
    method,
    muteHttpExceptions: true,
    headers: {
      Authorization: `Bearer ${ScriptApp.getOAuthToken()}`
    }
  };

  if (payload !== undefined) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload);
  }

  const response = UrlFetchApp.fetch(`https://docs.googleapis.com${path}`, options);
  const status = response.getResponseCode();
  const body = response.getContentText();
  let parsedBody = {};

  if (body) {
    try {
      parsedBody = JSON.parse(body);
    } catch (_) {
      parsedBody = { raw: body };
    }
  }

  if (status < 200 || status >= 300) {
    const apiMessage = parsedBody.error && parsedBody.error.message
      ? parsedBody.error.message
      : body || `HTTP ${status}`;
    throw new Error(`Google Docs API error (${status}): ${apiMessage}`);
  }

  return parsedBody;
}

function constantTimeEquals_(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
