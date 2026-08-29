import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { UnreadBadge } from "./unread-badge";

test("contador nao e renderizado quando o total e zero", () => {
  assert.equal(renderToStaticMarkup(<UnreadBadge count={0} />), "");
});

test("contador renderiza 99+ e mantem o total no rotulo acessivel", () => {
  const html = renderToStaticMarkup(<UnreadBadge count={134} />);
  assert.match(html, />99\+</);
  assert.match(html, /134 mensagens não lidas/);
});
