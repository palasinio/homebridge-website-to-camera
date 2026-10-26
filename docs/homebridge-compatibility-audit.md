# Homebridge compatibility audit — 2026-10-26

Compared upstream `f77eb7648c2c0d6badab00d45204869f72a69529` (3.0.1)
with `palasinio/master` and PR #56, both at
`0c4a3d88369ec3b3bc45c6bafbc8262d18bf01a3`.

## Changes from PR #56 already present upstream

| Change | Current upstream |
| --- | --- |
| CameraController selection and configureCameraSource fallback | CameraAccessory.js is byte-for-byte identical to the fork |
| Modern controller options and separate legacy stream options | Present, including the HB1 correction in 0c4a3d8 |
| Guards for absent CameraControl and StreamController | Present |
| String/binary session ID normalization | Present |
| prepareStream callback adaptation | Present, including the arity bug described below |
| handleStreamRequest completion callback | Present |
| Removal of username; process.getuid root detection | Present |

Upstream additionally falls back from publishCameraAccessories to
publishExternalAccessories. The fork still calls publishCameraAccessories
unconditionally, which is unavailable in Homebridge 2.0.2. Therefore the original
fork is not a suitable replacement for current upstream on that release.

Other differences are the removal of the ip dependency, IPv4 address selection,
browser cleanup/error handling, package metadata and README. Upstream requires
Node >=24 and HB ^1.8.0 || ^2.0.0; the fork declares older Node versions and HB2
betas. Those broader engine declarations do not establish runtime compatibility.
There is no remaining HB2 registration fix unique to PR #56 that needs merging.

## Confirmed callback defect and minimal correction

The modern HAP RTPStreamManagement calls prepareStream with an error-first
callback wrapped in `once`. In both tested HAP generations the wrapper's
`length` is zero. The old `callback.length >= 2` check consequently calls
`callback(response)` instead of `callback(undefined, response)`. HAP interprets
the response object as an error and returns SetupEndpoints status ERROR (2).

The correction selects the callback protocol using `this.controller`, set by
createController, rather than the callback's declared argument count. The legacy
camera-source path continues to receive its response as the first argument.
No accessory UUIDs, categories, publication methods or camera services change.

## Offline verification

Node 24.22.1; no HomeKit pairing, mDNS advertising, actual browser or RTP traffic.
The tests use real Homebridge API, PlatformAccessory, CameraController and
RTPStreamManagement implementations. Only the screenshot and local IP lookup
are stubbed. The fake connection is an EventEmitter; no server is published.

| Homebridge | HAP | Tests after correction |
| --- | --- | --- |
| 1.8.4 | hap-nodejs 0.12.2 | 4/4 pass* |
| 1.11.4 (repository lockfile) | hap-nodejs 0.14.3 | 4/4 pass |
| 2.0.2 (same versions as issue #57) | @homebridge/hap-nodejs 2.1.6 | 4/4 pass |

*HB 1.8.4/HAP 0.12.2 declare Node 18/20 support, so running their API tests on
Node 24 is an additional check, not proof of an officially supported combination.

Before the production correction, on HB1.11.4 and HB2.0.2 the registration and
stubbed-snapshot tests passed; the real SetupEndpoints regression and the
arity-independent legacy callback test failed. Both passed after the correction.

Tests cover:

1. Four cameras with explicit, unique IDs: stable distinct UUIDs, CAMERA category,
   plugin association, two CameraRTPStreamManagement services per accessory.
2. Snapshot bytes delivered through the real HAP CameraController, with rendering
   stubbed. This does not validate JPEG decoding or Chromium.
3. A TLV SetupEndpoints request traversing the real HAP callback wrapper and
   yielding status SUCCESS (0), without opening sockets.
4. The old one-argument response protocol even when a legacy callback happens
   to declare two parameters.

Run `npm ci --ignore-scripts` and `npm test` for the locked HB1 version.
To repeat against another installation, run
`HOMEBRIDGE_TEST_ROOT=/absolute/path/to/node_modules/homebridge npm test`.
For example, create an isolated HB2 installation with
`npm install --prefix /tmp/website-camera-hb2 --ignore-scripts homebridge@2.0.2`,
then use `/tmp/website-camera-hb2/node_modules/homebridge` as the test root.

## Registration and issue #57: what is and is not established

HB1.11.4 publishCameraAccessories simply delegates to publishExternalAccessories;
HB2.0.2 has only publishExternalAccessories. Both publish external accessories
using the same UUID-derived HomeKit address. The plugin retains the same UUID
generation and CAMERA category. The fallback alone therefore does not imply a
new accessory identity or a need to pair again.

Issue #57 first documents crashes on older versions, then reports that 3.0.1
starts and prints the external accessory's listening/pairing message. It still
reports unusability and inability to add the camera on May 20–21, 2026. No later
confirmation of recovery was present when reviewed. The callback defect is real,
but is reached during stream endpoint setup, not pairing. It does not establish
the cause of the reported pairing failure or prove that this patch resolves #57.

ScreenshotHelper opens Chromium lazily upon a snapshot request. Silence after
startup alone is not proof that no accessory was registered. The plugin's
handleStreamRequest still contains a TODO instead of sending video; this patch
does not add native live video. The documented MJPEG/ffmpeg mode is separate.

A separate existing identity defect is reproducible: without explicit IDs,
`Website 1` and `Website 2` both produce UUID
`454b96e6-581b-4129-a893-25a55ab6177d`. Name character codes are truncated to
12 characters before hashing. This affects both fork and upstream; it is not
evidence about the single camera in #57. The test uses distinct explicit IDs.
Changing existing UUIDs needs a separate migration decision and is outside this
minimal callback patch.

Actual pairing/discovery, persisted pairing state across HB1/HB2 upgrades,
Chromium rendering and physical Home app behavior remain untested. No tests
were performed on the user's local Homebridge installation.

## Disposition of PR #56

PR #56 is open and merge-conflicted. Its functional camera compatibility changes
are already present upstream, and merging its old package/README changes would
not fix #57. Recommend closing it as superseded after reviewing this focused
follow-up. The callback correction is new work on top of upstream, not a missing
change unique to the old PR. This audit does not close PR #56 or issue #57.

## Sources

- [PR #56](https://github.com/werthdavid/homebridge-website-to-camera/pull/56)
- [Issue #57](https://github.com/werthdavid/homebridge-website-to-camera/issues/57)
- [Pinned upstream](https://github.com/werthdavid/homebridge-website-to-camera/tree/f77eb7648c2c0d6badab00d45204869f72a69529)
- [Pinned fork](https://github.com/palasinio/homebridge-website-to-camera/tree/0c4a3d88369ec3b3bc45c6bafbc8262d18bf01a3)
- [HB1 API](https://github.com/homebridge/homebridge/blob/v1.11.4/src/api.ts)
- [HB2 API](https://github.com/homebridge/homebridge/blob/v2.0.2/src/api.ts)
- HAP source exercised from the npm installations listed above:
  lib/camera/RTPStreamManagement.js, lib/util/once.js and
  lib/controller/CameraController.js under each package's dist directory.
