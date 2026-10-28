import assert from "node:assert/strict";
import test from "node:test";

import { UppercaseInput, type UppercaseInputProps } from "./uppercase-input";

type CampoFalso = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  selecao: [number, number] | null;
  setSelectionRange: (inicio: number, fim: number) => void;
};

function campo(value: string, inicio: number, fim = inicio): CampoFalso {
  return {
    value,
    selectionStart: inicio,
    selectionEnd: fim,
    selecao: null,
    setSelectionRange(a, b) {
      this.selecao = [a, b];
    },
  };
}

function montar(props: Partial<UppercaseInputProps> = {}) {
  const recebidos: string[] = [];
  const element = UppercaseInput({ value: "", onValueChange: (v) => recebidos.push(v), ...props });
  const handlers = element.props as {
    onChange: (event: unknown) => void;
    onCompositionEnd: (event: unknown) => void;
  };
  return {
    recebidos,
    digitar: (input: CampoFalso, isComposing = false) =>
      handlers.onChange({ target: input, nativeEvent: { isComposing } }),
    compor: (input: CampoFalso) => handlers.onCompositionEnd({ currentTarget: input }),
  };
}

test("palavra digitada no meio vira maiuscula sem mandar o cursor para o fim", () => {
  const { recebidos, digitar } = montar();
  const input = campo("PASTILHA de FREIO", 11);

  digitar(input);

  assert.equal(input.value, "PASTILHA DE FREIO");
  assert.deepEqual(input.selecao, [11, 11]);
  assert.deepEqual(recebidos, ["PASTILHA DE FREIO"]);
});

test("selecao no meio do texto continua selecionada", () => {
  const { digitar } = montar();
  const input = campo("óleo MOTOR", 0, 4);

  digitar(input);

  assert.equal(input.value, "ÓLEO MOTOR");
  assert.deepEqual(input.selecao, [0, 4]);
});

test("texto ja em maiusculas nao e regravado", () => {
  const { recebidos, digitar } = montar();
  const input = campo("FILTRO", 3);

  digitar(input);

  assert.equal(input.selecao, null);
  assert.deepEqual(recebidos, ["FILTRO"]);
});

test("durante a composicao o texto passa como veio e converte no fim", () => {
  const { recebidos, digitar, compor } = montar();
  const input = campo("PEÇA á", 6);

  digitar(input, true);
  assert.equal(input.value, "PEÇA á");
  assert.equal(input.selecao, null);

  compor(input);
  assert.equal(input.value, "PEÇA Á");
  assert.deepEqual(input.selecao, [6, 6]);
  assert.deepEqual(recebidos, ["PEÇA á", "PEÇA Á"]);
});

test("formato com hifen da placa leva o cursor junto", () => {
  const placa = (valor: string) => {
    const limpo = valor.replace(/[^A-Z0-9]/g, "").slice(0, 7);
    return limpo.length <= 3 ? limpo : `${limpo.slice(0, 3)}-${limpo.slice(3)}`;
  };
  const { recebidos, digitar } = montar({ format: placa });

  const fim = campo("ABC1", 4);
  digitar(fim);
  assert.equal(fim.value, "ABC-1");
  assert.deepEqual(fim.selecao, [5, 5]);

  const meio = campo("ABxC-1D2", 3);
  digitar(meio);
  assert.equal(meio.value, "ABX-C1D2");
  assert.deepEqual(meio.selecao, [3, 3]);
  assert.deepEqual(recebidos, ["ABC-1", "ABX-C1D2"]);
});

test("caractere recusado pelo formato nao empurra o cursor", () => {
  const { digitar } = montar({ format: (valor) => valor.replace(/[^A-Z]/g, "").slice(0, 2) });
  const input = campo("p1", 2);

  digitar(input);

  assert.equal(input.value, "P");
  assert.deepEqual(input.selecao, [1, 1]);
});
