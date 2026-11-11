// Small helpers for reading form fields and query strings (always strings, arrays or missing).
import { SEARCH_MAX_LENGTH } from '../config/constants.js';

/** Whole number from a field, or `fallback` when it's empty or not a number. */
export const toInt = (value, fallback = 0) => (
  Number.isFinite(Number(value)) && String(value).trim() !== '' ? Math.trunc(Number(value)) : fallback
);

/** A field sent once or many times (checkboxes) as an array. */
export const asArray = (value) => (value == null ? [] : Array.isArray(value) ? value : [value]);

/** Trimmed text with runs of spaces collapsed, at most `max` characters. */
export const cleanText = (value, max) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

/** Text typed into a search box, or '' when there is none. */
export const searchText = (value) => (typeof value === 'string' ? value.trim().slice(0, SEARCH_MAX_LENGTH) : '');

export const hasErrors = (errors) => Object.keys(errors).length > 0;
