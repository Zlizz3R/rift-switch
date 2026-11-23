//! Windows integration: start with Windows (HKCU Run key) and the taskbar jump list
//! ("Switch to <account>" on a right-click of the taskbar button).

use std::path::Path;

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_NAME: &str = "Rift Switch";

pub fn set_autostart(on: bool, exe: &Path) {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE};
    let Ok(key) = winreg::RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(RUN_KEY, KEY_SET_VALUE | KEY_QUERY_VALUE)
    else {
        return;
    };
    // the old Electron version's entry ("electron.app.…" pointing at Rift Switch) would start a copy that no longer exists
    let old: Vec<String> = key
        .enum_values()
        .flatten()
        .filter(|(name, v)| {
            let cmd = v.to_string().to_lowercase();
            name.starts_with("electron.app.")
                && (cmd.contains("lol-switcher")
                    || cmd.contains("rift-switch")
                    || cmd.contains("rift switch"))
        })
        .map(|(name, _)| name)
        .collect();
    for name in old {
        let _ = key.delete_value(name);
    }
    if on {
        let _ = key.set_value(RUN_NAME, &format!("\"{}\" --hidden", exe.display()));
    } else {
        let _ = key.delete_value(RUN_NAME);
    }
}

/// Same id as the installer's shortcut, so the pinned taskbar button shows the jump list.
pub fn set_app_id(id: &str) {
    use windows::core::PCWSTR;
    let w = wide(id);
    unsafe {
        let _ =
            windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(PCWSTR(w.as_ptr()));
    }
}

/// A Windows notification (bottom right, Action Center). Shown under the app's own id when the
/// installer's Start menu shortcut carries it, otherwise under PowerShell's id (a portable copy –
/// Windows only shows notifications of apps it knows).
pub fn toast(app_id: &str, title: &str, body: &str) -> std::thread::JoinHandle<String> {
    let (app_id, title, body) = (app_id.to_string(), xml_text(title), xml_text(body));
    // WinRT wants a thread of its own (COM set up for it)
    std::thread::spawn(move || {
        use windows::core::HSTRING;
        use windows::Data::Xml::Dom::XmlDocument;
        use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};
        unsafe {
            let _ = windows::Win32::System::WinRT::RoInitialize(
                windows::Win32::System::WinRT::RO_INIT_MULTITHREADED,
            );
        }
        let id = if installed_shortcut() {
            app_id
        } else {
            r"{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe"
                .to_string()
        };
        let show = || -> windows::core::Result<()> {
            let xml = XmlDocument::new()?;
            xml.LoadXml(&HSTRING::from(format!(
                "<toast scenario=\"reminder\"><visual><binding template=\"ToastGeneric\"><text>{title}</text><text>{body}</text></binding></visual><audio src=\"ms-winsoundevent:Notification.Default\"/><actions/></toast>"
            )))?;
            let n = ToastNotification::CreateToastNotification(&xml)?;
            ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(id.as_str()))?
                .Show(&n)
        };
        match show() {
            Ok(()) => format!("shown as {id}"),
            Err(e) => format!("failed as {id}: {e}"),
        }
    })
}
fn xml_text(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
/// The installer's Start menu shortcut (it carries the app id) – for this user or for everyone.
fn installed_shortcut() -> bool {
    [std::env::var("APPDATA"), std::env::var("ProgramData")]
        .into_iter()
        .flatten()
        .any(|base| {
            std::fs::read_dir(
                std::path::Path::new(&base).join(r"Microsoft\Windows\Start Menu\Programs"),
            )
            .map(|d| {
                d.flatten().any(|e| {
                    let n = e.file_name().to_string_lossy().to_lowercase();
                    n.starts_with("rift switch") && n.ends_with(".lnk")
                        || e.path().is_dir() && n.starts_with("rift switch")
                })
            })
            .unwrap_or(false)
        })
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

/// tasks: (account id, title, description); empty = no jump list.
pub fn set_jump_list(exe: &Path, tasks: &[(String, String, String)]) {
    use windows::core::{Interface, PCWSTR, PROPVARIANT};
    use windows::Win32::Storage::EnhancedStorage::PKEY_Title;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::Common::{IObjectArray, IObjectCollection};
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
    use windows::Win32::UI::Shell::{
        DestinationList, EnumerableObjectCollection, ICustomDestinationList, IShellLinkW, ShellLink,
    };

    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let Ok(list) = CoCreateInstance::<_, ICustomDestinationList>(
            &DestinationList,
            None,
            CLSCTX_INPROC_SERVER,
        ) else {
            return;
        };
        if tasks.is_empty() {
            let _ = list.DeleteList(PCWSTR::null());
            return;
        }
        let mut max = 0u32;
        let Ok(_removed) = list.BeginList::<IObjectArray>(&mut max) else {
            return;
        };
        let Ok(coll) = CoCreateInstance::<_, IObjectCollection>(
            &EnumerableObjectCollection,
            None,
            CLSCTX_INPROC_SERVER,
        ) else {
            return;
        };
        let exe_w = wide(&exe.to_string_lossy());
        for (id, title, desc) in tasks {
            let Ok(link) =
                CoCreateInstance::<_, IShellLinkW>(&ShellLink, None, CLSCTX_INPROC_SERVER)
            else {
                continue;
            };
            let args = wide(&format!("--switch={id}"));
            let desc_w = wide(desc);
            let _ = link.SetPath(PCWSTR(exe_w.as_ptr()));
            let _ = link.SetArguments(PCWSTR(args.as_ptr()));
            let _ = link.SetDescription(PCWSTR(desc_w.as_ptr()));
            let _ = link.SetIconLocation(PCWSTR(exe_w.as_ptr()), 0);
            if let Ok(store) = link.cast::<IPropertyStore>() {
                let v = PROPVARIANT::from(title.as_str());
                let _ = store.SetValue(&PKEY_Title, &v);
                let _ = store.Commit();
            }
            let _ = coll.AddObject(&link);
        }
        if let Ok(arr) = coll.cast::<IObjectArray>() {
            let _ = list.AddUserTasks(&arr);
        }
        let _ = list.CommitList();
    }
}
