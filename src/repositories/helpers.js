/**
 * A LIKE / ILIKE pattern matching `text` anywhere. % _ and \ typed by a visitor are matched literally
 * (backslash is Postgres's default LIKE escape character).
 */
export const containsPattern = (text) => `%${text.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
