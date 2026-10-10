// Validation rules, ported from the reference implementation's validators.
import { isValidDiasporaId } from '../diaspora-id.ts';

/** A validation rule: returns `true` when the value is acceptable. */
export interface Rule {
  name: string;
  /** If true the rule is also applied to absent optional values (like `not_nil`). */
  checksNil?: boolean;
  test(value: unknown): boolean;
}

const GUID_REGEX = /^[0-9A-Za-z\-_@.:]{15,254}[0-9A-Za-z]$/;

/** True if `value` is a valid GUID (16–255 chars of `[0-9A-Za-z-_@.:]`, ending alphanumeric). */
export function isValidGuid(value: unknown): value is string {
  return typeof value === 'string' && GUID_REGEX.test(value);
}

export const notNil: Rule = { name: 'not_nil', checksNil: true, test: (v) => v !== undefined };

export const notEmpty: Rule = {
  name: 'not_empty',
  test: (v) =>
    v !== undefined &&
    !((typeof v === 'string' || Array.isArray(v)) && v.length === 0),
};

export const diasporaId: Rule = { name: 'diaspora_id', test: isValidDiasporaId };

export const guid: Rule = { name: 'guid', test: isValidGuid };

export const boolean: Rule = { name: 'boolean', test: (v) => typeof v === 'boolean' };

export const numeric: Rule = {
  name: 'numeric',
  test: (v) => typeof v === 'number' && Number.isFinite(v),
};

export function maxLength(max: number): Rule {
  return {
    name: `length(max ${max})`,
    test: (v) => v === undefined || (typeof v === 'string' && [...v].length <= max),
  };
}

export function minItems(min: number): Rule {
  return {
    name: `length(min ${min})`,
    test: (v) => v === undefined || (Array.isArray(v) && v.length >= min),
  };
}

export function regex(pattern: RegExp): Rule {
  return {
    name: `regular_expression(${pattern.source})`,
    test: (v) => v === undefined || (typeof v === 'string' && pattern.test(v)),
  };
}

/** A diaspora* name: no `;`, bounded length. */
export function name(max: number): Rule {
  return {
    name: `name(max ${max})`,
    test: (v) => v === undefined || (typeof v === 'string' && !v.includes(';') && [...v].length <= max),
  };
}

/** URI rule; `parts` lists the URI components that must be present. */
export function uri(...parts: Array<'host' | 'path'>): Rule {
  return {
    name: `URI(${parts.join(',')})`,
    test: (v) => {
      if (v === undefined) return true;
      if (typeof v !== 'string') return false;
      let host = '';
      let path = '';
      try {
        const url = new URL(v);
        host = url.host;
        path = url.pathname;
      } catch {
        // relative reference
        if (/\s/.test(v)) return false;
        path = v.split(/[?#]/)[0] ?? '';
      }
      if (parts.includes('host') && host === '') return false;
      if (parts.includes('path') && path === '') return false;
      return true;
    },
  };
}

export const birthday: Rule = {
  name: 'birthday',
  test: (v) => {
    if (v === undefined || v === '') return true;
    if (typeof v !== 'string') return false;
    const match = /(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (!match) return false;
    const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  },
};

export function tagCount(max: number): Rule {
  return {
    name: `tag_count(max ${max})`,
    test: (v) => v === undefined || (typeof v === 'string' && v.split('#').length - 1 <= max),
  };
}

export function diasporaIdList(min: number): Rule {
  return {
    name: `diaspora_id_list(min ${min})`,
    test: (v) => {
      if (typeof v !== 'string') return false;
      const ids = v.split(';');
      return ids.length >= min && ids.every((id) => isValidDiasporaId(id));
    },
  };
}

export function oneOf(...values: string[]): Rule {
  return {
    name: `one_of(${values.join('|')})`,
    test: (v) => v === undefined || (typeof v === 'string' && values.includes(v)),
  };
}
