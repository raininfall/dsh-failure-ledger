import { createHash } from 'node:crypto'

/**
 * Version of the signature rule set below. Stored failures carry the version
 * that produced them, so changing any rule invalidates earlier signatures
 * instead of silently regrouping them.
 */
export const RULES_VERSION = 1

const STDERR_MARKER = '[stderr]'
const EXIT_MARKER = /^\[(?:exit code|killed by signal|timed out after|stopped)/
const RUNTIME_ECHO = /^\[rtk\] ran:/
const KEYWORD = /\b(?:error|exception|failed|failure|not found|denied|refused|invalid|cannot|could not|no such|unable|missing)\b/i

/**
 * Lines that announce a verdict rather than merely mentioning one: an error
 * class with its message, or a shell/driver preamble such as `bash: ...`.
 *
 * Ranked above `KEYWORD` because a stack trace's first line is the real
 * failure while echoed source lines often contain the word "error" by
 * accident.
 */
const VERDICT = /^(?:[A-Za-z_.]{0,40}(?:Error|Exception)\b[^:]*:|bash: |fatal: |FAIL\b|panic: )/
const HAS_ALNUM = /[A-Za-z0-9]/
const ANSI = /\u001b\[[0-9;]*m/g
const UNIX_PATH = /\/(?:[^\s/'"]+\/)+[^\s'":]+/g
const WINDOWS_PATH = /[A-Za-z]:\\[^\s"']*/g
const LONG_HEX = /\b[0-9a-f]{8,}\b/gi
const DIGITS = /\d+/g
const WHITESPACE = /\s+/g

/**
 * Keep only lines that can carry an error message: skip the empty line, the
 * exit/timeout markers the bash renderer appends, the runtime's own command
 * echo, and punctuation-only noise such as `===` or `}`.
 * @param line - One trimmed line of tool output.
 * @returns Whether the line is a signature candidate.
 */
function isCandidate(line) {
  if (line.length === 0) return false
  if (line === STDERR_MARKER) return false
  if (EXIT_MARKER.test(line)) return false
  if (RUNTIME_ECHO.test(line)) return false
  return HAS_ALNUM.test(line)
}

/**
 * Split tool output into candidate lines, preferring the stderr section.
 * @param text - Tool result text.
 * @returns Candidate lines of the stderr section, and of the whole text.
 */
function sections(text) {
  const stderrAt = text.indexOf(STDERR_MARKER)
  const whole = text.split('\n').map((line) => line.trim()).filter(isCandidate)
  if (stderrAt === -1) return { stderr: whole, whole, hasStderr: false }
  const rest = text.slice(stderrAt + STDERR_MARKER.length)
  return { stderr: rest.split('\n').map((line) => line.trim()).filter(isCandidate), whole, hasStderr: true }
}

/**
 * Pick the raw line that represents a failure.
 *
 * Rule order: a verdict line in the stderr section, else a keyword line
 * there, else the same two ranks anywhere, else the first stderr line, else
 * the last line of the output.
 * @param text - Tool result text.
 * @returns The raw, un-normalized line, or `''` when nothing qualifies.
 */
export function extractErrorLine(text) {
  if (typeof text !== 'string' || text.length === 0) return ''
  const { stderr, whole, hasStderr } = sections(text)
  const ranked = (lines) => lines.find((line) => VERDICT.test(line)) ?? lines.find((line) => KEYWORD.test(line))
  const rankedInStderr = ranked(stderr)
  if (rankedInStderr !== undefined) return rankedInStderr
  const rankedAnywhere = ranked(whole)
  if (rankedAnywhere !== undefined) return rankedAnywhere
  if (stderr.length > 0) return stderr[0]
  if (hasStderr) return ''
  return whole.length > 0 ? whole[whole.length - 1] : ''
}

/**
 * Normalize one line so that failures differing only by paths, ids, numbers
 * or whitespace collapse into one signature.
 * @param line - Raw line.
 * @param options - `maxChars` caps the result length.
 * @returns The normalized line.
 */
export function normalizeLine(line, { maxChars = 160 } = {}) {
  let text = String(line).replace(ANSI, '')
  text = text.replace(UNIX_PATH, '<path>')
  text = text.replace(WINDOWS_PATH, '<path>')
  text = text.replace(LONG_HEX, '<id>')
  text = text.replace(DIGITS, '<n>')
  text = text.replace(WHITESPACE, ' ').trim()
  return truncate(text, maxChars)
}

/**
 * Cap a string at `maxChars` characters without splitting surrogate pairs.
 * @param text - Input text.
 * @param maxChars - Maximum length.
 * @returns The possibly shortened text.
 */
function truncate(text, maxChars) {
  if (!Number.isInteger(maxChars) || maxChars <= 0) return text
  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars)
  const lastCode = cut.charCodeAt(cut.length - 1)
  return lastCode >= 0xd800 && lastCode <= 0xdbff ? cut.slice(0, -1) : cut
}

/**
 * Full signature of one failure: extract the line, then normalize it.
 * @param content - Tool result text.
 * @param options - `maxChars` caps the signature length.
 * @returns The signature, or `''` when the content carries no line.
 */
export function signatureOf(content, { maxChars = 160 } = {}) {
  const line = extractErrorLine(content)
  if (line.length === 0) return ''
  return normalizeLine(line, { maxChars })
}

/**
 * Derive the stable group id for a (tool, kind, signature) triple.
 * @param tool - Tool name.
 * @param kind - Failure kind.
 * @param signature - Normalized signature.
 * @returns Sixteen lowercase hex characters.
 */
export function groupIdOf(tool, kind, signature) {
  return createHash('sha1').update(`${tool}\u0000${kind}\u0000${signature}`).digest('hex').slice(0, 16)
}
