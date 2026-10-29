const CREDENTIAL_SERVICE: &str = "org.ai4h.eval-lab";

fn entry(connection_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(CREDENTIAL_SERVICE, connection_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn store_secret(connection_id: String, secret: String) -> Result<(), String> {
    entry(&connection_id)?
        .set_password(&secret)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_secret(connection_id: String) -> Result<Option<String>, String> {
    match entry(&connection_id)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn delete_secret(connection_id: String) -> Result<(), String> {
    match entry(&connection_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

/// Best-effort diagnostic probe: re-issues a GET and returns the full reqwest
/// error chain (DNS / connect / proxy causes that the HTTP plugin drops when
/// it serializes errors to the frontend as its top-level Display string).
#[tauri::command]
async fn probe_url(url: String) -> String {
    let client = reqwest::Client::new();
    match client.get(&url).send().await {
        Ok(response) => format!("probe succeeded: HTTP {}", response.status()),
        Err(error) => {
            let mut chain = vec![error.to_string()];
            let mut source = std::error::Error::source(&error);
            while let Some(err) = source {
                chain.push(err.to_string());
                source = err.source();
            }
            chain.join(" <- ")
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            store_secret,
            get_secret,
            delete_secret,
            probe_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running AI4H Eval Lab");
}
