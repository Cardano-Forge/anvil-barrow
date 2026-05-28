export function withController<
  T extends AsyncGenerator<unknown, void, unknown>,
>(generator: T, controller: AbortController): T {
  const generatorReturn = generator.return;
  generator.return = () => {
    const res = generatorReturn.call(generator);
    controller.abort("generator returned");
    return res;
  };
  return generator;
}
