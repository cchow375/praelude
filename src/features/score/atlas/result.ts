export type DomainResult<T, Code extends string = string> =
  | { ok: true; value: T }
  | { ok: false; code: Code; message: string };

export function success<T>(value: T): DomainResult<T, never> {
  return { ok: true, value };
}

export function failure<Code extends string>(
  code: Code,
  message: string,
): DomainResult<never, Code> {
  return { ok: false, code, message };
}
