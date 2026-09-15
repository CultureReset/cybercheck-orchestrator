// What the kernel promises the layers above it.
//
// The shell, the remote control and anything else that talks to the kernel
// declare the range of this number they were built against. A box that pulls a
// mismatched pair refuses to start that connection and says so, rather than
// half-working and failing later in front of the owner.
//
// Bump MINOR for additions that older callers can ignore. Bump MAJOR when
// something a caller depends on changes shape or disappears — that is the only
// kind of change that can break a box, so it is the only one that gets a number
// callers have to react to.
//
//   1  invoke, approvals, receipts, repairs, drift, device, sync, attention
export const INTERFACE = 'node.kernel';
export const MAJOR = 1;
export const MINOR = 0;
export function interfaceReport() {
  return { interface: INTERFACE, major: MAJOR, minor: MINOR, version: `${INTERFACE}/${MAJOR}.${MINOR}` };
}
