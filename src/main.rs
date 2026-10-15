use adw::prelude::*;
use gtk::{gio, glib};
use std::{
    cell::RefCell,
    ffi::OsStr,
    fs, io,
    os::unix::fs::{DirBuilderExt, PermissionsExt},
    path::{Path, PathBuf},
    rc::Rc,
};

const APP_ID: &str = "io.github.whatsapp_fedora.Desktop";
const ENGINE: &str = include_str!("../runtime/main.cjs");
type ProcessSlot = Rc<RefCell<Option<gio::Subprocess>>>;

fn private_directory(path: &Path) -> io::Result<()> {
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(path)?;
    if !fs::symlink_metadata(path)?.file_type().is_dir() {
        return Err(io::Error::other(
            "Le dossier de session doit être un vrai dossier.",
        ));
    }
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
}

fn runtime_paths() -> io::Result<(PathBuf, PathBuf, PathBuf)> {
    let data = glib::user_data_dir().join(APP_ID);
    let cache = glib::user_cache_dir().join(APP_ID);
    private_directory(&data)?;
    private_directory(&cache)?;
    let profile = data.join("chromium");
    private_directory(&profile)?;
    let script = cache.join(format!("engine-{}.cjs", env!("CARGO_PKG_VERSION")));
    if script
        .symlink_metadata()
        .is_ok_and(|meta| !meta.file_type().is_file())
    {
        return Err(io::Error::other(
            "Le fichier moteur doit être un vrai fichier.",
        ));
    }
    fs::write(&script, ENGINE)?;
    let executable = std::env::var_os("WA_ELECTRON_BINARY")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let installed = PathBuf::from("/usr/lib64/whatsapp-desktop/electron/electron");
            if installed.is_file() {
                installed
            } else {
                glib::home_dir().join(".local/npm-global/lib/node_modules/electron/dist/electron")
            }
        });
    if !executable.is_file() {
        return Err(io::Error::other(
            "Le moteur Electron est absent. Consultez les instructions d’installation.",
        ));
    }
    Ok((executable, script, profile))
}

fn send_command(process: &gio::Subprocess, command: &'static [u8]) {
    if let Some(pipe) = process.stdin_pipe() {
        let result = pipe.write_bytes(&glib::Bytes::from_static(command), gio::Cancellable::NONE);
        if !matches!(result, Ok(count) if count == command.len() as isize) {
            eprintln!("Le moteur ne répond plus à la commande native.");
        }
    }
}

fn show_about(app: &adw::Application) {
    let dialog = adw::AboutWindow::builder()
        .application(app).application_name("Fedora WhatsApp — non officiel")
        .application_icon("chat-message-new-symbolic")
        .version(env!("CARGO_PKG_VERSION"))
        .comments("Client indépendant et non officiel pour WhatsApp Web, sans affiliation à Meta. La messagerie et sa sécurité sont fournies par le client officiel WhatsApp.")
        .build();
    dialog.present();
}

fn read_events(stream: gio::DataInputStream, app: glib::WeakRef<adw::Application>) {
    let next = stream.clone();
    stream.read_line_async(
        glib::Priority::DEFAULT,
        gio::Cancellable::NONE,
        move |result| {
            if let Ok(Some(line)) = result {
                if let Some(application) = app.upgrade() {
                    if line.as_ref() == b"about" {
                        show_about(&application);
                    }
                    read_events(next, app);
                }
            }
        },
    );
}

fn show_error(app: &adw::Application, detail: &str) {
    let window = adw::ApplicationWindow::builder()
        .application(app)
        .title("Fedora WhatsApp — non officiel")
        .default_width(640)
        .default_height(420)
        .build();
    let page = adw::StatusPage::builder()
        .title("Démarrage impossible")
        .description(detail)
        .icon_name("dialog-warning-symbolic")
        .build();
    let retry = gtk::Button::with_label("Réessayer");
    retry.set_halign(gtk::Align::Center);
    let weak = window.downgrade();
    let app_weak = app.downgrade();
    retry.connect_clicked(move |_| {
        if let Some(app) = app_weak.upgrade() {
            app.activate();
        }
        if let Some(window) = weak.upgrade() {
            window.close();
        }
    });
    page.set_child(Some(&retry));
    window.set_content(Some(&page));
    window.present();
}

fn start_runtime(
    app: &adw::Application,
    slot: &ProcessSlot,
) -> Result<(), Box<dyn std::error::Error>> {
    let (executable, script, profile) = runtime_paths()?;
    let launcher = gio::SubprocessLauncher::new(
        gio::SubprocessFlags::STDIN_PIPE | gio::SubprocessFlags::STDOUT_PIPE,
    );
    for name in [
        "ELECTRON_RUN_AS_NODE",
        "NODE_OPTIONS",
        "ELECTRON_DISABLE_SANDBOX",
        "ELECTRON_DISABLE_SECURITY_WARNINGS",
        "ELECTRON_EXTRA_LAUNCH_ARGS",
    ] {
        launcher.unsetenv(name);
    }
    launcher.setenv("WA_PROFILE", &profile, true);
    launcher.setenv("WA_DESKTOP_ID", APP_ID, true);
    // Smoke diagnostics are unavailable in production builds and never export account content.
    if !cfg!(debug_assertions) {
        launcher.unsetenv("WA_SMOKE_REPORT");
    }
    let process = launcher.spawn(&[
        executable.as_os_str(),
        script.as_os_str(),
        OsStr::new("--class=io.github.whatsapp_fedora.Desktop"),
    ])?;
    if let Some(output) = process.stdout_pipe() {
        read_events(gio::DataInputStream::new(&output), app.downgrade());
    }
    *slot.borrow_mut() = Some(process.clone());
    let hold = app.hold();
    let app = app.clone();
    let slot = slot.clone();
    let watched = process.clone();
    process.wait_async(gio::Cancellable::NONE, move |result| {
        slot.borrow_mut().take();
        drop(hold);
        if result.is_ok() && watched.is_successful() { app.quit(); }
        else { show_error(&app, "Le moteur Chromium s’est arrêté. Relancez le client. Le profil de session a été conservé."); }
    });
    Ok(())
}

fn main() -> glib::ExitCode {
    glib::set_application_name("Fedora WhatsApp");
    let app = adw::Application::builder().application_id(APP_ID).build();
    let slot: ProcessSlot = Rc::new(RefCell::new(None));
    for (name, command, accelerator) in [
        ("reload", b"reload\n".as_slice(), "<Control>r"),
        (
            "media-permissions",
            b"media\n".as_slice(),
            "<Control><Shift>v",
        ),
        ("quit", b"quit\n".as_slice(), "<Control>q"),
    ] {
        let action = gio::SimpleAction::new(name, None);
        let processes = slot.clone();
        let weak = app.downgrade();
        action.connect_activate(move |_, _| {
            if let Some(process) = processes.borrow().as_ref() {
                send_command(process, command);
            } else if let Some(app) = weak.upgrade() {
                app.quit();
            }
        });
        app.add_action(&action);
        app.set_accels_for_action(&format!("app.{name}"), &[accelerator]);
    }
    let about = gio::SimpleAction::new("about", None);
    let weak = app.downgrade();
    about.connect_activate(move |_, _| {
        if let Some(app) = weak.upgrade() {
            show_about(&app);
        }
    });
    app.add_action(&about);
    let processes = slot.clone();
    app.connect_shutdown(move |_| {
        if let Some(process) = processes.borrow().as_ref() {
            send_command(process, b"quit\n");
        }
    });
    app.connect_activate(move |app| {
        let process = slot.borrow().clone();
        if let Some(process) = process {
            send_command(&process, b"focus\n");
        } else if let Err(error) = start_runtime(app, &slot) {
            show_error(app, &error.to_string());
        }
    });
    app.run()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn storage_is_private_and_does_not_follow_a_symlink() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "whatsapp-storage-test-{}-{nonce}",
            std::process::id()
        ));
        let profile = root.join("profile");
        private_directory(&profile).unwrap();
        assert_eq!(
            fs::metadata(&profile).unwrap().permissions().mode() & 0o777,
            0o700
        );
        fs::set_permissions(&profile, fs::Permissions::from_mode(0o755)).unwrap();
        private_directory(&profile).unwrap();
        assert_eq!(
            fs::metadata(&profile).unwrap().permissions().mode() & 0o777,
            0o700
        );
        let alias = root.join("alias");
        std::os::unix::fs::symlink(&profile, &alias).unwrap();
        assert!(private_directory(&alias).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
