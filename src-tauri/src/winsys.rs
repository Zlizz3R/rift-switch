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
