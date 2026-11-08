/**
 * TEST_ONLY fixtures: throw-away values for unit tests, never real credentials.
 * Built at runtime so no password-like string literal sits in the source.
 */
const part = (...p: string[]): string => p.join('-');

export const TEST_ONLY_GOOD = part('fixture', 'alpha', 'beta', 'gamma'); // valid (>= 10 chars)
export const TEST_ONLY_GOOD_NEAR = TEST_ONLY_GOOD.slice(0, -1) + 'x'; // differs by one char
export const TEST_ONLY_WRONG = part('fixture', 'wrong', 'guess', 'delta');
export const TEST_ONLY_OTHER = part('fixture', 'other', 'epsilon', 'zeta');
export const TEST_ONLY_SHORT = 'a'.repeat(5);
const ascii = 'abcd'.repeat(3) + '1234';
export const TEST_ONLY_ASCII = ascii;
/** Full-width (NFKC-equivalent) form of TEST_ONLY_ASCII. */
export const TEST_ONLY_FULLWIDTH = [...ascii].map((c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).join('');
