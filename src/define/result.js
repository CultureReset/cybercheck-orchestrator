/* Ported from twentyhq/twenty, packages/twenty-sdk (AGPL-3.0). See README.md. */

// Twenty's contract, unchanged: every define* returns this rather than
// throwing. A package with six broken fields should report six problems on the
// first run, not one per run for six runs.
export const createValidationResult = ({ config, errors = [], warnings = [] }) => ({
  success: errors.length === 0,
  config,
  errors,
  warnings,
});

// Errors are collected across a whole package and raised together, so this is
// the only place that decides what "invalid" reads like.
export class DefinitionError extends Error {
  constructor(errors) {
    super(`invalid package definition:\n  ${errors.join('\n  ')}`);
    this.name = 'DefinitionError';
    this.errors = errors;
  }
}
