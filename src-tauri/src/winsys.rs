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
        let _ = key.set_value(RUN_NAME, &format!("\"{}\" --autostart", exe.display()));
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

/// Are Windows notifications on at all? (Settings → System → Notifications; off = no app's toast
/// shows, ours neither). Not set = on.
pub fn toasts_enabled() -> bool {
    use winreg::enums::HKEY_CURRENT_USER;
    winreg::RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\PushNotifications")
        .and_then(|k| k.get_value::<u32, _>("ToastEnabled"))
        .map_or(true, |v| v != 0)
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

/// Puts a login name or password on the clipboard so that Windows keeps it out of the clipboard
/// history (Win+V), cloud sync and clipboard monitors. → the clipboard's sequence number after
/// it (to clear it later only if nothing else was copied since), None if it couldn't be opened.
pub fn copy_private(text: &str) -> Option<u32> {
    use windows::core::w;
    use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, GetClipboardSequenceNumber, OpenClipboard,
        RegisterClipboardFormatW, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    const CF_UNICODETEXT: u32 = 13;
    // memory with these bytes for the clipboard (None: none to be had – it is freed again)
    let alloc = |bytes: &[u8]| -> Option<HGLOBAL> {
        // SAFETY: a fresh block of the right size, locked only while the bytes are copied in
        unsafe {
            let h = GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1)).ok()?;
            let p = GlobalLock(h) as *mut u8;
            if p.is_null() {
                let _ = GlobalFree(h);
                return None;
            }
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), p, bytes.len());
            let _ = GlobalUnlock(h);
            Some(h)
        }
    };
    // on success the system owns the memory; on failure it is still ours to free
    let set = |fmt: u32, h: HGLOBAL| -> bool {
        // SAFETY: the clipboard is open and ours (EmptyClipboard), h a filled moveable block
        unsafe {
            if SetClipboardData(fmt, HANDLE(h.0)).is_ok() {
                true
            } else {
                let _ = GlobalFree(h);
                false
            }
        }
    };
    // the text first: when there is no memory for it, the clipboard stays as it was
    let wide: Vec<u8> = text
        .encode_utf16()
        .chain(std::iter::once(0))
        .flat_map(u16::to_le_bytes)
        .collect();
    let text_mem = alloc(&wide)?;
    // SAFETY: the clipboard is opened, emptied (it becomes ours), filled and always closed
    unsafe {
        let mut opened = false;
        for _ in 0..10 {
            if OpenClipboard(None).is_ok() {
                opened = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
        if !opened {
            let _ = GlobalFree(text_mem);
            return None;
        }
        let _ = EmptyClipboard();
        let ok = set(CF_UNICODETEXT, text_mem);
        // keep it out of the clipboard history (Win+V), cloud sync and clipboard monitors
        if ok {
            let zero = 0u32.to_le_bytes();
            for f in [
                w!("ExcludeClipboardContentFromMonitorProcessing"),
                w!("CanIncludeInClipboardHistory"),
                w!("CanUploadToCloudClipboard"),
            ] {
                let id = RegisterClipboardFormatW(f);
                if let (true, Some(h)) = (id != 0, alloc(&zero)) {
                    set(id, h);
                }
            }
        }
        let _ = CloseClipboard();
        ok.then(|| GetClipboardSequenceNumber())
    }
}
/// Empties the clipboard – only if it still holds what copy_private put there (sequence number).
pub fn clear_clipboard_if(seq: u32) {
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, GetClipboardSequenceNumber, OpenClipboard,
    };
    // SAFETY: open, empty, close
    unsafe {
        if GetClipboardSequenceNumber() != seq || OpenClipboard(None).is_err() {
            return;
        }
        let _ = EmptyClipboard();
        let _ = CloseClipboard();
    }
}
