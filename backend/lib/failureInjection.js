export async function invokeDependency(operation, { retries = 1, validate = (value) => value != null } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const result = await operation();
      if (!validate(result)) throw Object.assign(new Error('Malformed dependency response'), { terminal: true });
      return result;
    } catch (error) {
      lastError = error;
      if (error.terminal || attempt === retries) break;
    }
  }
  throw lastError;
}
