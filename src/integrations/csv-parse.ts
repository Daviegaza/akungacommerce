/**
 * RFC 4180 CSV parser (the reading half of csv.ts). Handles quoted fields,
 * escaped quotes (""), commas and newlines inside quotes, CRLF/LF/CR line
 * endings and a leading UTF-8 BOM. Also accepts semicolon- or tab-separated
 * files, which spreadsheet apps export in many locales.
 */

export interface ParsedCsv {
  /** Every record, including the header, as raw strings. Blank lines are dropped. */
  records: string[][]
  delimiter: ',' | ';' | '\t'
  /** Set when a quoted field is never closed. */
  error: string | null
}

function detectDelimiter(text: string): ',' | ';' | '\t' {
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? ''
  const count = (ch: string) => firstLine.split(ch).length - 1
  const counts: [',' | ';' | '\t', number][] = [
    [',', count(',')],
    [';', count(';')],
    ['\t', count('\t')],
  ]
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 0 ? counts[0][0] : ','
}

export function parseCsv(input: string, opts: { maxRecords?: number } = {}): ParsedCsv {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const delimiter = detectDelimiter(text)
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let inQuotes = false
  let fieldStarted = false
  const max = opts.maxRecords ?? Number.POSITIVE_INFINITY

  const endRecord = () => {
    record.push(field)
    // Drop fully blank lines.
    if (!(record.length === 1 && record[0].trim() === '')) records.push(record)
    record = []
    field = ''
    fieldStarted = false
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"' && !fieldStarted) {
      inQuotes = true
      fieldStarted = true
    } else if (ch === delimiter) {
      record.push(field)
      field = ''
      fieldStarted = false
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      endRecord()
      if (records.length >= max) return { records, delimiter, error: null }
    } else {
      field += ch
      fieldStarted = true
    }
  }
  if (inQuotes) return { records, delimiter, error: 'A quoted field is never closed. Check for a stray " character.' }
  if (field !== '' || record.length > 0) endRecord()
  return { records, delimiter, error: null }
}
