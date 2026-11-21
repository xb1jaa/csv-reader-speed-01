// Fast CSV reader: a drop-in for csv-reader 1.0.0 (make.fun csv-reader-speed-01).
//
// run(input) takes {text, header} and returns {columns, rows, errors} with
// exactly csv-reader's reading of the text:
//
// - A U+FEFF at the very start is dropped.
// - A record ends at LF or CRLF; a line left with no characters is no record.
// - Outside quotes a CR not followed by LF is dropped (error stray_cr).
// - A field that opens with a quote runs to the next quote that is not
//   doubled; "" inside it is one quote and each CRLF or lone CR inside it
//   reads as LF. What follows its closing quote, up to the next comma or
//   line break, is appended as it stands (error quote_junk, when the field
//   ends). A quote that never closes is a literal character and the text
//   after it is read again as unquoted (error unterminated_quote).
// - A quote inside an unquoted field is a literal character.
// - Fields stay strings, never trimmed or converted.
// - columns is the first record when header is true, else null; rows holds
//   the records after it (every record when header is false), each padded
//   with empty strings (short_row, with fields: its field count) or cut
//   (long_row, with extra: the cut fields) to the first record's width.
// - Each error is {code, line, row} in the order met, a record's short_row
//   or long_row when it ends. line is the 1-based line its record starts
//   on, counting every LF, CRLF and lone CR inside quotes; row is its
//   record's index in rows, null for the header.
//
// Speed: most records hold no quote before their line break, so they are
// taken whole with indexOf/slice/split (C++ speed) instead of walking
// character by character. Only records that hold a quote go through the
// field-by-field reader, and that reader jumps from quote to quote with
// indexOf instead of scanning every character.

const COMMA = 44; // ,
const QUOTE = 34; // "
const LF = 10; // \n
const CR = 13; // \r
const BOM = 0xfeff;

export function run(input) {
  const text = input.text;
  const header = input.header;
  const n = text.length;
  let pos = 0;
  if (n > 0 && text.charCodeAt(0) === BOM) pos = 1;

  const rows = [];
  const errors = [];
  let columns = header ? [] : null;
  let width = -1;
  let line = 1; // current physical line, 1-based

  while (pos < n) {
    // A line left with no characters is no record.
    const c0 = text.charCodeAt(pos);
    if (c0 === LF) {
      pos++;
      line++;
      continue;
    }
    if (c0 === CR && text.charCodeAt(pos + 1) === LF) {
      pos += 2;
      line++;
      continue;
    }

    const recStartLine = line;
    const rowIdx = width === -1 && header ? null : rows.length;

    // Find the next LF; the record ends there unless a quote opens first.
    const nl = text.indexOf('\n', pos);
    const seg = nl === -1 ? text.slice(pos) : text.slice(pos, nl);
    let segEnd = seg.length;
    if (segEnd > 0 && seg.charCodeAt(segEnd - 1) === CR) segEnd--; // CRLF

    let fields;
    const quoteAt = seg.indexOf('"');
    if (quoteAt === -1 || quoteAt >= segEnd) {
      // No quote in this record: no quoted field can span past the LF.
      const crAt = seg.indexOf('\r');
      if (crAt === -1 || crAt === segEnd) {
        // Clean record: split on commas, nothing else to do.
        fields =
          segEnd === seg.length ? seg.split(',') : seg.slice(0, segEnd).split(',');
      } else {
        // Stray CRs inside unquoted fields: each is dropped, one error.
        const raw = seg.slice(0, segEnd).split(',');
        fields = new Array(raw.length);
        for (let f = 0; f < raw.length; f++) {
          const field = raw[f];
          if (field.indexOf('\r') === -1) {
            fields[f] = field;
          } else {
            const parts = field.split('\r');
            for (let k = 1; k < parts.length; k++) {
              errors.push({ code: 'stray_cr', line: recStartLine, row: rowIdx });
            }
            fields[f] = parts.join('');
          }
        }
      }
      pos = nl === -1 ? n : nl + 1;
      line++;
    } else {
      // Slow path: this record holds a quote. Read it field by field.
      const res = parseQuotedRecord(text, pos, n, line, recStartLine, rowIdx, errors);
      fields = res.fields;
      pos = res.pos;
      line = res.line;
    }

    if (width === -1) {
      width = fields.length;
      if (header) {
        columns = fields;
      } else {
        rows.push(fields);
      }
    } else if (fields.length < width) {
      errors.push({
        code: 'short_row',
        line: recStartLine,
        row: rowIdx,
        fields: fields.length,
      });
      const padded = fields.slice();
      for (let f = fields.length; f < width; f++) padded.push('');
      rows.push(padded);
    } else if (fields.length > width) {
      errors.push({
        code: 'long_row',
        line: recStartLine,
        row: rowIdx,
        extra: fields.slice(width),
      });
      rows.push(fields.slice(0, width));
    } else {
      rows.push(fields);
    }
  }

  return { columns, rows, errors };
}

// Read one record that holds a quote, starting at pos (the record's first
// character, outside any quotes). Returns {fields, pos, line}: pos at the
// character after the record's line break (or n), line the physical line
// there. Field errors are pushed to errors as they are met.
function parseQuotedRecord(text, pos, n, line, recStartLine, rowIdx, errors) {
  const fields = [];
  let p = pos;
  let ln = line;

  for (;;) {
    let field;
    if (p < n && text.charCodeAt(p) === QUOTE) {
      // Quoted field: jump from quote to quote to find the closing one.
      let k = p + 1;
      let close = -1;
      for (;;) {
        const qq = text.indexOf('"', k);
        if (qq === -1) break;
        if (text.charCodeAt(qq + 1) === QUOTE) {
          k = qq + 2;
          continue;
        }
        close = qq;
        break;
      }

      if (close === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        errors.push({ code: 'unterminated_quote', line: recStartLine, row: rowIdx });
        let m = p;
        let crs = 0;
        while (m < n) {
          const c = text.charCodeAt(m);
          if (c === COMMA || c === LF) break;
          if (c === CR) {
            if (text.charCodeAt(m + 1) === LF) break;
            crs++;
            errors.push({ code: 'stray_cr', line: recStartLine, row: rowIdx });
            m++;
            continue;
          }
          m++;
        }
        field =
          crs === 0 ? text.slice(p, m) : text.slice(p, m).split('\r').join('');
        p = m;
      } else {
        // Content between the quotes.
        const content = text.slice(p + 1, close);
        let special = -1;
        for (let i = 0; i < content.length; i++) {
          const c = content.charCodeAt(i);
          if (c === QUOTE || c === CR || c === LF) {
            special = i;
            break;
          }
        }
        if (special === -1) {
          field = content;
        } else {
          // "" is one quote; each CRLF or lone CR inside reads as LF.
          // Count the line breaks too: they move the next record's line.
          let out = '';
          let start = 0;
          for (let i = 0; i < content.length; i++) {
            const c = content.charCodeAt(i);
            if (c === QUOTE) {
              out += content.slice(start, i) + '"';
              i++; // skip the second quote of the pair
              start = i + 1;
            } else if (c === CR) {
              out += content.slice(start, i) + '\n';
              ln++;
              if (content.charCodeAt(i + 1) === LF) i++;
              start = i + 1;
            } else if (c === LF) {
              out += content.slice(start, i) + '\n';
              ln++;
              start = i + 1;
            }
          }
          out += content.slice(start);
          field = out;
        }

        // What follows the closing quote, up to the next comma or line
        // break, is appended as it stands; a lone CR in there is dropped.
        let m = close + 1;
        let junk = false;
        for (;;) {
          let j = m;
          while (j < n) {
            const c = text.charCodeAt(j);
            if (c === COMMA || c === LF || c === CR) break;
            j++;
          }
          if (j > m) {
            junk = true;
            field += text.slice(m, j);
          }
          m = j;
          if (m >= n) break;
          const c = text.charCodeAt(m);
          if (c === COMMA || c === LF) break;
          if (text.charCodeAt(m + 1) === LF) break; // CRLF
          // Lone CR: dropped, one error; the junk goes on after it.
          errors.push({ code: 'stray_cr', line: recStartLine, row: rowIdx });
          m++;
        }
        if (junk) {
          errors.push({ code: 'quote_junk', line: recStartLine, row: rowIdx });
        }
        p = m;
      }
    } else {
      // Unquoted field: to the next comma or line break, dropping lone CRs.
      // The next ',' or LF bounds the field; any CR inside is stray unless
      // it is the first half of the CRLF that ends the field.
      const mComma = text.indexOf(',', p);
      const mLf = text.indexOf('\n', p);
      let m = mComma === -1 ? mLf : mLf === -1 ? mComma : Math.min(mComma, mLf);
      if (m === -1) m = n;
      let end = m;
      if (m < n && text.charCodeAt(m) === LF && m > p && text.charCodeAt(m - 1) === CR) {
        end = m - 1;
      }
      const seg = text.slice(p, end);
      if (seg.indexOf('\r') === -1) {
        field = seg;
      } else {
        const parts = seg.split('\r');
        for (let k = 1; k < parts.length; k++) {
          errors.push({ code: 'stray_cr', line: recStartLine, row: rowIdx });
        }
        field = parts.join('');
      }
      p = m;
    }
    fields.push(field);

    // After a field: comma starts another, a line break ends the record.
    if (p >= n) break;
    const c = text.charCodeAt(p);
    if (c === COMMA) {
      p++;
      if (p >= n) {
        fields.push('');
        break;
      }
      const c2 = text.charCodeAt(p);
      if (c2 === LF) {
        fields.push('');
        p++;
        ln++;
        break;
      }
      if (c2 === CR && text.charCodeAt(p + 1) === LF) {
        fields.push('');
        p += 2;
        ln++;
        break;
      }
      if (c2 === CR) {
        // Lone CR after a comma: dropped, one error; the next field
        // starts after it.
        errors.push({ code: 'stray_cr', line: recStartLine, row: rowIdx });
        p++;
      }
      continue;
    }
    if (c === LF) {
      p++;
      ln++;
      break;
    }
    // A CR here can only be the first half of a CRLF (a lone CR after a
    // field is dropped by the field readers above).
    p += 2;
    ln++;
    break;
  }

  return { fields, pos: p, line: ln };
}
