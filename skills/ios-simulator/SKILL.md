---
name: ios-simulator
description: Run, inspect, and drive iOS apps in the Simulator from the shell on Xcode 27 and later, where DeviceHub replaces Simulator.app. Use when booting or choosing a simulator, installing or launching an app on it, taking simulator screenshots, switching light/dark, granting permissions, typing or tapping in a simulated app, or writing UI tests that run there, even if the user only says "run it on the phone sim" or "check the screen". For building and running macOS apps, use build-run-debug instead.
---

# iOS Simulator

Xcode 27 ships no `Simulator.app`. The window that shows and controls a
simulator is **DeviceHub** (`com.apple.dt.Devices`), at
`/Applications/Xcode.app/Contents/Applications/DeviceHub.app`. Spotlight finds
nothing for the old bundle ID `com.apple.iphonesimulator`. Don't search for
Simulator.app or try to open it.

Most work needs no window at all: `xcrun simctl` and `xcodebuild` control
simulators directly. Open DeviceHub (`open -b com.apple.dt.Devices`) only when
someone has to see or touch the screen.

## Default workflow

1. Pick the device by UDID, never by name. Several runtimes carry the same
   device names.
   ```sh
   xcrun simctl list devices booted
   xcrun simctl list devices available
   ```
   Boot one only when the user asks or has agreed: `xcrun simctl boot <udid>`.
2. Build and test with an explicit destination:
   ```sh
   xcodebuild -project App.xcodeproj -scheme App \
     -destination 'platform=iOS Simulator,id=<udid>' \
     -derivedDataPath .build/xcode test
   ```
3. Install, launch, and reset state with simctl:
   ```sh
   xcrun simctl install <udid> path/to/App.app
   xcrun simctl launch <udid> <bundle-id>
   xcrun simctl terminate <udid> <bundle-id>
   xcrun simctl uninstall <udid> <bundle-id>   # next run is a fresh install
   xcrun simctl keychain <udid> reset           # Keychain items can outlive uninstall
   ```
4. Set up the screen and permissions deterministically:
   ```sh
   xcrun simctl ui <udid> appearance dark       # or light
   xcrun simctl privacy <udid> grant camera <bundle-id>   # or revoke, reset
   xcrun simctl io <udid> screenshot /tmp/shot.png
   ```

## Driving the UI

Default to an XCUITest target. It reaches SwiftUI controls reliably and
records screenshots, while desktop automation of DeviceHub often can't (see
Gotchas).

- **Feed data in through the launch environment** instead of typing or
  pasting. Read a DEBUG-only variable in the app, then set it:
  - from simctl: `SIMCTL_CHILD_NAME=value xcrun simctl launch …` sets `NAME`
    in the app;
  - from `xcodebuild test`: `TEST_RUNNER_NAME=value xcodebuild … test` sets
    `NAME` in the test runner, which passes it on with
    `app.launchEnvironment["NAME"]`.
  `xcrun simctl openurl <udid> <url>` works too when the app handles the URL.
- **Collect screenshots** from tests with `XCTAttachment` (lifetime
  `.keepAlways`) and a `-resultBundlePath`, then:
  ```sh
  xcrun xcresulttool export attachments --path run.xcresult --output-path out/
  ```
  `out/manifest.json` maps each exported file to its attachment name. A
  failed UI test also exports an "App UI hierarchy" text file. Read it before
  you guess at a query.

## Gotchas

- **DeviceHub ignores injected text.** Automation tools' `type_text` and
  `set_value` don't reach SwiftUI text fields in DeviceHub. System Events
  `keystroke` works after DeviceHub is activated and its Capture Keyboard
  option is on.
- **The pasteboard is unreliable.** After `xcrun simctl pbcopy`,
  `pbpaste` came back empty, and DeviceHub's pasteboard sync replaced copied
  text with a promised image. Use the launch environment instead.
- **Some controls are missing from the accessibility tree.** Toolbar buttons
  in sheets may not appear in DeviceHub's accessibility tree. Tap them by
  coordinates from a fresh screenshot, or test them with XCUITest.
- **The simulator has no camera.** `AVCaptureDevice.default(for: .video)` is
  nil. Requesting access still shows the system prompt, so check for a camera
  first. System prompts belong to SpringBoard:
  `XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Don’t Allow"]`.
- **XCUITest finds some elements in unexpected places.**
  - A navigation title is in `app.navigationBars["Title"]`, not
    `staticTexts`.
  - A `TextField` with a prompt or `axis: .vertical` isn't found by its
    label. Give it an `accessibilityIdentifier` and query
    `app.descendants(matching: .any).matching(identifier:)`.
