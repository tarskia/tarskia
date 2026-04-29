let counter = 0;

export function createId(prefix: string) {
  const cryptoObject = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof cryptoObject?.randomUUID === 'function') {
    return `${prefix}-${cryptoObject.randomUUID()}`;
  }
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}
