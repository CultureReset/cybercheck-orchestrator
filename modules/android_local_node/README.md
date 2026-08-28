# android_local_node

Fills the `workspace.executor` slot with a real Android device over ADB.

This is the module that turns "the phone plugged into the computer" into an
executor the kernel can route to. It is a **package**, not a kernel change:
`src/drivers/android.js` already says everything above it talks in steps rather
than in ADB, and this is the other side of that seam.

```
capability request          channel.push / channel.read
        ↓
orchestrator               policy → approval → route: android
        ↓
workspace.executor         ← this module, bound per business
        ↓
ADB                        uiautomator dump → find node → input tap/text
        ↓
the phone                  the real app, logged into the owner's real account
        ↓
read back                  same appmap, read route
        ↓
verified | drifted         and a receipt either way
```

## Attaching a device

```bash
adb devices                       # get the serial
export ANDROID_SERIAL=<serial>
docker compose --profile usb -f modules/android_local_node/docker/docker-compose.yml up
```

The container spec lives in this package, not at the repo root. The platform
does not require ADB; this one executor does. Delete the package and the
container goes with it.

For an emulator or a phone over wifi, use `--profile tcp`; any device value
containing `:` is treated as a TCP target and connected on demand.

Run `adb` in exactly one place. The USB handle is exclusive, so a host `adb`
server and a container one will fight over the phone, and the symptom is a
device stuck in `offline`.

## Binding it to a business

The platform default is `android_simulator`, which needs no hardware. A real
device is a **per-business binding**, because a business's phone holds that
business's logged-in accounts:

```js
await bind({
  businessId,                       // this business, not the platform
  slot: 'workspace.executor',
  packageKey: 'android_local_node',
});
```

One workspace resolves to one device serial, three ways, most specific first:

| | |
|---|---|
| `GHOST_ADB_DEVICES` | `{"<workspaceId>":"<serial or host:port>"}` |
| `GHOST_ADB_DEVICE_MAP` | path to a JSON file of the same shape |
| `ANDROID_SERIAL` | one device, one workspace — the single-phone case |

Never map two workspaces to one serial. Tenant isolation here is physical: the
apps on that device are signed into one business's accounts.

## How a target is found

Semantically, and only then as coordinates:

1. `resource-id` — full, or the part after `/`
2. exact `text`
3. exact `content-desc`
4. case-insensitive exact, then contains

The tap coordinate is computed from the matched node's bounds at the moment of
the tap. A layout change that moves a button does not break an appmap. A
**rename** does — and that is the failure the repair queue exists for, so it
raises `StepError` and stops rather than guessing at the next-best button.

## Steps

The same six the Simulator speaks:

```js
{ open: "com.google.android.apps.business" }
{ tap: "Edit" }                     // resource-id, text or content-desc
{ type: "07:00", into: "opens_at" }
{ read: "opens_at" }                // into the run's readings
{ expect: "Saved" }                 // fails the run if absent
{ wait: 500 }
```

## What this package deliberately does not export

`installApp`. It is `optional` on the `workspace.executor` contract, and the
simulator provides it. On real hardware the owner installs the app and signs
in themselves — their credential never passes through the platform — and
`installOnDevice()` records that the app is expected to be there rather than
pretending to put it there.

This package also declares no `defaultPriority`, so it is never bound
automatically. A real device is always an explicit choice.

## Known limits

- **Clearing a field** sends `KEYCODE_DEL` once per existing character. There is
  no portable select-all on Android, and a field whose contents the tree reports
  incorrectly will be cleared incorrectly.
- **`provider_binding.config` is not threaded into `run()`.** The kernel calls
  `run({ workspace, steps })`, so per-business settings come from the device map
  rather than the binding row. Passing `config` through is a one-line kernel
  change if it is ever wanted.
- **Untested against real hardware.** The step vocabulary, the tree parser and
  the failure path are exercised by `tests/device-loop.mjs` through the
  simulator. The ADB calls themselves have not been run against a phone.
