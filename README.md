# WhatsApp for Fedora

I built this to use WhatsApp on Fedora. It opens the official [WhatsApp Web](https://web.whatsapp.com/) client in its own window and keeps your login between restarts. Rust handles the launcher, GTK4/libadwaita handles native dialogs, and Electron/Chromium runs the web client.

This is an unofficial project. It has no affiliation with WhatsApp, Meta or the Fedora Project.

![WhatsApp for Fedora showing the login page with the QR code hidden](docs/images/whatsapp-for-fedora.png)

*The login screen in the app. I hid the QR code for the screenshot. No account was linked.*

## Other Linux distros

If you want to use it on another Linux distro, you can ask Codex or Claude Code to help make it work there. If you don't have either or want me to do it, [contact me by opening an issue](https://github.com/ayexito/whatsapp-for-fedora/issues/new) with your distro and version. I'll adapt it for you.

Only Fedora 44 x86_64 has been tested so far. Each port needs to be built and checked on its target distro.

## Where it's at

Version 0.1.0 is an early build. You need to build it from source for now.

I've checked startup, the official login screen, saved sessions, opening the app from the launcher, reusing one window, and the renderer sandbox on Fedora 44 x86_64 with Hyprland Wayland. I also reopened a linked account across restarts and tested navigation and scrolling.

The app has reload/quit shortcuts, a native About dialog and permission prompts for the microphone, camera and speaker selection. Closing the window quits it. Notifications, attachment downloads, external links, preferences and tray/background mode still need work. Downloads, popups, external navigation and other web permission requests are currently blocked.

Sending and receiving messages, voice/video calls, GNOME Wayland, X11 and long-running use still need testing. There is no RPM or Flatpak package yet.

## Install on Fedora 44 (x86_64)

Open a terminal and run these commands. `sudo dnf` installs the dependencies; the app and Electron are installed for your user.

```sh
sudo dnf install git cargo rust rustfmt gcc pkgconf-pkg-config gtk4-devel libadwaita-devel nodejs npm gtk3 nss alsa-lib cups-libs libdrm mesa-libgbm desktop-file-utils
git clone https://github.com/ayexito/whatsapp-for-fedora.git
cd whatsapp-for-fedora
npm install --global --prefix "$HOME/.local/npm-global" electron@44.7.2
cargo build --locked
```

When the build finishes successfully, stay in that directory and add it to your app launcher:

```sh
install -Dm755 target/debug/whatsapp-desktop "$HOME/.local/bin/whatsapp-desktop"
install -Dm644 data/io.github.whatsapp_fedora.Desktop.svg "$HOME/.local/share/icons/hicolor/scalable/apps/io.github.whatsapp_fedora.Desktop.svg"
desktop-file-install --dir="$HOME/.local/share/applications" --set-key=Exec --set-value="\"$HOME/.local/bin/whatsapp-desktop\"" data/io.github.whatsapp_fedora.Desktop.desktop
desktop-file-validate "$HOME/.local/share/applications/io.github.whatsapp_fedora.Desktop.desktop"
update-desktop-database "$HOME/.local/share/applications"
gtk-update-icon-cache --force --ignore-theme-index "$HOME/.local/share/icons/hicolor"
```

Search for "WhatsApp for Fedora" or "WhatsApp pour Fedora" in your launcher. You can also start it with:

```sh
"$HOME/.local/bin/whatsapp-desktop"
```

Link your account using the QR code in the app. After installation, you can open it from the launcher without a terminal. Keep the user-level Electron installation above; the app still needs it.

To update, quit the app, rebuild it, then repeat the install commands. Your saved session stays in place.

To uninstall, quit the app and remove these three files, then rerun the two database/cache commands above:

- `~/.local/bin/whatsapp-desktop`
- `~/.local/share/applications/io.github.whatsapp_fedora.Desktop.desktop`
- `~/.local/share/icons/hicolor/scalable/apps/io.github.whatsapp_fedora.Desktop.svg`

This leaves your session data on disk. Revoke the linked device from WhatsApp on your phone if you want to end its access.

## Build with Podman instead

After cloning the repository and installing the desktop dependencies and Electron above, you can use rootless Podman for the Rust build:

```sh
sudo dnf install podman
./scripts/build-fedora.sh --locked
podman run --rm -v "$PWD:/work:z" -v whatsapp-cargo-cache:/root/.cargo localhost/whatsapp-fedora-builder cargo test --locked
```

Then use the same launcher-install commands above. The build runs in the container; the app runs on your desktop. The Fedora image digest and Cargo.lock are pinned, but Fedora repository packages can change between builds.

The app uses Electron 44.7.2. Keep it updated for security fixes. For development, `WA_ELECTRON_BINARY` can point to another trusted Electron executable. Otherwise, the launcher looks in `/usr/lib64/whatsapp-desktop/electron/electron`, then `~/.local/npm-global/lib/node_modules/electron/dist/electron`.

## Login and privacy

Link your account through WhatsApp's normal QR process. The app stores the Chromium profile in `$XDG_DATA_HOME/io.github.whatsapp_fedora.Desktop/chromium`, usually `~/.local/share/io.github.whatsapp_fedora.Desktop/chromium`. The app's data/cache folders have mode 0700, so other Linux users can't normally read them. That does not protect against root or malware running as your user. Disk and keyring encryption haven't been independently checked.

WhatsApp provides the messaging and encryption. This app has no developer backend or added tracker. The web page runs with sandboxing, context isolation and TLS checks enabled, without Node integration or a native IPC bridge.

Never upload your profile, cache, QR codes or account logs to GitHub or an AI chat. Read [SECURITY.md](SECURITY.md) before sharing diagnostics.

## Checks and known issues

```sh
cargo test --locked
node --test tests/security.test.cjs
```

These tests check private storage permissions, trusted URLs, renderer isolation and the media permission handlers. They cover consent, denial, revocation and requests from untrusted origins. They do not verify message delivery or calling. After building, check login, restart persistence, typing, resizing and reconnection on your own machine.

If scrolling is slow, close the app and create an empty `software-rendering` file inside its private Chromium profile. Remove only that file, with the app closed, to restore hardware acceleration. This helped on the tested Intel/NVIDIA Hyprland setup; other profiles keep hardware acceleration by default. Video CPU use and battery effects still need testing.

When WhatsApp requests the microphone or camera, choose **Autoriser** (Allow) or **Refuser** (Deny) in the native dialog. Speaker selection has a separate permission. Grants last until you quit the app. Press Alt to show the menu, then use **Application → Révoquer les autorisations audio/vidéo et recharger** to revoke them and stop media by reloading the page.

Use WhatsApp's own device selector when available, or Fedora's sound settings for the default microphone and output. Actual calls still depend on WhatsApp Web supporting them for your account and browser. Permissions alone do not establish working voice/video calls.
