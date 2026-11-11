const XML_ENTITIES = { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' };

export const xmlEscape = (s) => String(s).replace(/[<>&'"]/g, (c) => XML_ENTITIES[c]);
