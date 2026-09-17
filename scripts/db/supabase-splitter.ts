/**
 * Porte fiel do separador de comandos da CLI do Supabase (pkg/parser/state.go e
 * token.go, v2.84.5), que o `db push` usa antes de mandar cada comando como
 * prepared statement. Serve para os testes de migration quebrarem igual ao
 * deploy.
 *
 * Armadilha conhecida: a CLI procura a palavra ATOMIC em qualquer lugar fora de
 * aspas, $$ e comentários, inclusive dentro de um identificador. Um nome de
 * coluna com essas seis letras abre um bloco que só fecha num END, e o resto do
 * arquivo vira um comando só ("cannot insert multiple commands into a prepared
 * statement"). Identificador entre aspas não dispara.
 *
 * Mantenha a lógica espelhando o Go, inclusive nas esquisitices.
 */

interface State {
  /** `data` são os bytes do comando atual até o fim do caractere lido. null emite o comando. */
  next(r: string, data: Buffer): State | null;
}

const BEGIN_ATOMIC = "ATOMIC";
const END_ATOMIC = "END";

function equalFoldAscii(window: Buffer, expected: string) {
  if (window.length !== expected.length) return false;
  for (let index = 0; index < window.length; index += 1) {
    const byte = window[index];
    if (byte > 0x7f) return false;
    if (String.fromCharCode(byte).toUpperCase() !== expected[index].toUpperCase()) return false;
  }
  return true;
}

function tail(data: Buffer, length: number) {
  return data.subarray(Math.max(0, data.length - length));
}

class ReadyState implements State {
  next(r: string, data: Buffer): State | null {
    switch (r) {
      case "$":
        return new TagState(data.length - Buffer.byteLength(r));
      case "'":
      case '"':
        return new QuoteState(r);
      case "-":
        return new CommentState();
      case "/":
        return new BlockState();
      case "\\":
        return new EscapeState();
      case ";":
        return null;
      case "(":
        return new AtomicState(this, Buffer.from(")"));
      case "c":
      case "C": {
        const offset = data.length - BEGIN_ATOMIC.length;
        if (offset >= 0 && equalFoldAscii(data.subarray(offset), BEGIN_ATOMIC)) {
          return new AtomicState(this, Buffer.from(END_ATOMIC));
        }
        return this;
      }
      default:
        return this;
    }
  }
}

class CommentState implements State {
  next(r: string, data: Buffer): State | null {
    if (r === "-") return new DollarState(Buffer.from("\n"));
    return new ReadyState().next(r, data);
  }
}

class BlockState implements State {
  private depth = 0;

  next(r: string, data: Buffer): State | null {
    const window = tail(data, 2).toString("latin1");
    if (window === "/*") {
      this.depth += 1;
      return this;
    }
    if (this.depth === 0) return new ReadyState().next(r, data);
    if (window === "*/") {
      this.depth -= 1;
      if (this.depth === 0) return new ReadyState();
    }
    return this;
  }
}

class QuoteState implements State {
  private escape = false;

  constructor(private readonly delimiter: string) {}

  next(r: string, data: Buffer): State | null {
    if (this.escape) {
      if (r === this.delimiter) {
        this.escape = false;
        return this;
      }
      return new ReadyState().next(r, data);
    }
    if (r === this.delimiter) this.escape = true;
    return this;
  }
}

class DollarState implements State {
  constructor(private readonly delimiter: Buffer) {}

  next(_r: string, data: Buffer): State | null {
    return tail(data, this.delimiter.length).equals(this.delimiter) ? new ReadyState() : this;
  }
}

class TagState implements State {
  constructor(private readonly offset: number) {}

  next(r: string, data: Buffer): State | null {
    if (r === "$") return new DollarState(Buffer.from(data.subarray(this.offset)));
    if (/^[\p{L}\p{Nd}_]$/u.test(r)) return this;
    return new ReadyState().next(r, data);
  }
}

class EscapeState implements State {
  next(): State | null {
    return new ReadyState();
  }
}

class AtomicState implements State {
  constructor(private prev: State, private readonly delimiter: Buffer) {}

  next(r: string, data: Buffer): State | null {
    const curr = this.prev.next(r, data);
    if (curr !== null) this.prev = curr;
    if (this.prev instanceof ReadyState && equalFoldAscii(tail(data, this.delimiter.length), this.delimiter.toString("latin1"))) {
      return new ReadyState();
    }
    return this;
  }
}

/** Equivale a `parser.SplitAndTrim`: separa, tira `;` à direita, apara espaços e descarta vazios. */
export function splitLikeSupabaseCli(sql: string): string[] {
  const bytes = Buffer.from(sql, "utf8");
  const statements: string[] = [];
  let state: State = new ReadyState();
  let start = 0;
  let position = 0;

  const emit = (end: number) => {
    const trimmed = bytes.subarray(start, end).toString("utf8").replace(/;+$/, "").trim();
    if (trimmed) statements.push(trimmed);
    start = end;
  };

  for (const char of sql) {
    const end = position + Buffer.byteLength(char);
    const next = state.next(char, bytes.subarray(start, end));
    position = end;
    if (next === null) {
      emit(end);
      state = new ReadyState();
    } else {
      state = next;
    }
  }
  if (start < bytes.length) emit(bytes.length);
  return statements;
}
