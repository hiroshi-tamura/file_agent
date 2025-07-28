#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use warp::{Filter, Rejection, Reply};
use warp::http::Method;
use walkdir::WalkDir;
use sha2::{Sha256, Digest};
use systray::Application;
use base64::{Engine as _, engine::general_purpose};

#[cfg(target_os = "windows")]
use native_windows_gui as nwg;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Config {
    token: String,
    port: u16,
}

impl Config {
    fn get_ini_path() -> PathBuf {
        let exe_path = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
        let exe_dir = exe_path.parent().unwrap_or_else(|| Path::new("."));
        exe_dir.join("file_agent.ini")
    }
    
    fn load() -> Self {
        let ini_path = Self::get_ini_path();
        
        if let Ok(content) = fs::read_to_string(&ini_path) {
            println!("設定ファイル読み込み: {}", ini_path.display());
            
            let mut port = 8767;
            let mut token = "default-token-12345".to_string();
            
            for line in content.lines() {
                let line = line.trim();
                if line.starts_with("port=") {
                    if let Ok(p) = line[5..].parse::<u16>() {
                        port = p;
                    }
                } else if line.starts_with("token=") {
                    token = line[6..].to_string();
                }
            }
            
            return Config { token, port };
        }
        
        println!("設定ファイルが見つかりません。デフォルト設定を使用します。");
        let default_config = Self::default();
        let _ = default_config.save(); // デフォルト設定を保存
        default_config
    }
    
    fn save(&self) -> Result<(), Box<dyn std::error::Error>> {
        let ini_path = Self::get_ini_path();
        let content = format!(
            "[Settings]\nport={}\ntoken={}\n",
            self.port,
            self.token
        );
        
        fs::write(&ini_path, content)?;
        println!("設定ファイルを保存しました: {}", ini_path.display());
        Ok(())
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            token: "default-token-12345".to_string(),
            port: 8767,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct FileInfo {
    path: String,
    name: String,
    is_file: bool,
    size: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ApiResponse<T> {
    success: bool,
    data: Option<T>,
    error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ReadRequest {
    path: String,
    token: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct WriteRequest {
    path: String,
    content: String,
    token: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct WriteBinaryRequest {
    path: String,
    content: String, // Base64エンコードされたバイナリデータ
    token: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct DeleteRequest {
    path: String,
    token: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct SearchRequest {
    directory: String,
    pattern: String,
    token: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct CreateRequest {
    path: String,
    is_directory: bool,
    token: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct MoveRequest {
    source: String,
    destination: String,
    token: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct CopyRequest {
    source: String,
    destination: String,
    token: String,
}

fn verify_token(token: &str, expected_hash: &str) -> bool {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    let result = hasher.finalize();
    let hash = format!("{:x}", result);
    hash == expected_hash
}

async fn check_auth(token: &str, expected_hash: &str) -> Result<(), String> {
    if !verify_token(token, expected_hash) {
        Err("認証エラー: 無効なトークンです".to_string())
    } else {
        Ok(())
    }
}

async fn read_file(request: ReadRequest, expected_hash: String) -> Result<impl Reply, Rejection> {
    if let Err(e) = check_auth(&request.token, &expected_hash).await {
        return Ok(warp::reply::json(&ApiResponse::<String> {
            success: false,
            data: None,
            error: Some(e),
        }));
    }
    
    match fs::read_to_string(&request.path) {
        Ok(content) => Ok(warp::reply::json(&ApiResponse {
            success: true,
            data: Some(content),
            error: None,
        })),
        Err(e) => Ok(warp::reply::json(&ApiResponse::<String> {
            success: false,
            data: None,
            error: Some(e.to_string()),
        })),
    }
}

async fn read_binary_file(request: ReadRequest, expected_hash: String) -> Result<impl Reply, Rejection> {
    if let Err(e) = check_auth(&request.token, &expected_hash).await {
        return Ok(warp::reply::json(&ApiResponse::<String> {
            success: false,
            data: None,
            error: Some(e),
        }));
    }
    
    match fs::read(&request.path) {
        Ok(content) => {
            let base64_content = general_purpose::STANDARD.encode(&content);
            Ok(warp::reply::json(&ApiResponse {
                success: true,
                data: Some(base64_content),
                error: None,
            }))
        },
        Err(e) => Ok(warp::reply::json(&ApiResponse::<String> {
            success: false,
            data: None,
            error: Some(e.to_string()),
        })),
    }
}

async fn write_file(request: WriteRequest, expected_hash: String) -> Result<impl Reply, Rejection> {
    if let Err(e) = check_auth(&request.token, &expected_hash).await {
        return Ok(warp::reply::json(&ApiResponse::<String> {
            success: false,
            data: None,
            error: Some(e),
        }));
    }
    
    match fs::write(&request.path, &request.content) {
        Ok(_) => Ok(warp::reply::json(&ApiResponse {
            success: true,
            data: Some("File written successfully".to_string()),
            error: None,
        })),
        Err(e) => Ok(warp::reply::json(&ApiResponse::<String> {
            success: false,
            data: None,
            error: Some(e.to_string()),
        })),
    }
}

async fn write_binary_file(request: WriteBinaryRequest, expected_hash: String) -> Result<impl Reply, Rejection> {
    if let Err(e) = check_auth(&request.token, &expected_hash).await {
        return Ok(warp::reply::json(&ApiResponse::<String> {
            success: false,
            data: None,
            error: Some(e),
        }));
    }
    
    // Base64デコード
    match general_purpose::STANDARD.decode(&request.content) {
        Ok(binary_data) => {
            // バイナリデータをファイルに書き込み
            match fs::write(&request.path, &binary_data) {
                Ok(_) => Ok(warp::reply::json(&ApiResponse {
                    success: true,
                    data: Some("Binary file written successfully".to_string()),
                    error: None,
                })),
                Err(e) => Ok(warp::reply::json(&ApiResponse::<String> {
                    success: false,
                    data: None,
                    error: Some(format!("File write error: {}", e)),
                })),
            }
        },
        Err(e) => Ok(warp::reply::json(&ApiResponse::<String> {
            success: false,
            data: None,
            error: Some(format!("Base64 decode error: {}", e)),
        })),
    }
}

async fn delete_file(request: DeleteRequest, expected_hash: String) -> Result<impl Reply, Rejection> {
    if let Err(e) = check_auth(&request.token, &expected_hash).await {
        return Ok(warp::reply::json(&ApiResponse::<String> {
            success: false,
            data: None,
            error: Some(e),
        }));
    }
    
    let path = Path::new(&request.path);
    let result = if path.is_file() {
        fs::remove_file(path)
    } else if path.is_dir() {
        fs::remove_dir_all(path)
    } else {
        return Ok(warp::reply::json(&ApiResponse::<String> {
            success: false,
            data: None,
            error: Some("Path does not exist".to_string()),
        }));
    };

    match result {
        Ok(_) => Ok(warp::reply::json(&ApiResponse {
            success: true,
            data: Some("Deleted successfully".to_string()),
            error: None,
        })),
        Err(e) => Ok(warp::reply::json(&ApiResponse::<String> {
            success: false,
            data: None,
            error: Some(e.to_string()),
        })),
    }
}

async fn search_files(request: SearchRequest, expected_hash: String) -> Result<impl Reply, Rejection> {
    if let Err(e) = check_auth(&request.token, &expected_hash).await {
        return Ok(warp::reply::json(&ApiResponse::<Vec<FileInfo>> {
            success: false,
            data: None,
            error: Some(e),
        }));
    }
    
    let mut files = Vec::new();
    let pattern = request.pattern.to_lowercase();

    for entry in WalkDir::new(&request.directory)
        .into_iter()
        .filter_map(|e| e.ok())
        .take(1000)
    {
        let path = entry.path();
        let name = path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_lowercase();

        if name.contains(&pattern) {
            let metadata = entry.metadata().ok();
            files.push(FileInfo {
                path: path.to_string_lossy().to_string(),
                name: path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string(),
                is_file: path.is_file(),
                size: metadata.as_ref().map(|m| m.len()),
            });
        }
    }

    Ok(warp::reply::json(&ApiResponse {
        success: true,
        data: Some(files),
        error: None,
    }))
}

async fn list_directory(path: String, token: String, expected_hash: String) -> Result<impl Reply, Rejection> {
    if !verify_token(&token, &expected_hash) {
        return Ok(warp::reply::json(&ApiResponse::<Vec<FileInfo>> {
            success: false,
            data: None,
            error: Some("認証エラー: 無効なトークンです".to_string()),
        }));
    }

    let mut files = Vec::new();
    
    match fs::read_dir(&path) {
        Ok(entries) => {
            for entry in entries {
                if let Ok(entry) = entry {
                    let path = entry.path();
                    let metadata = entry.metadata().ok();
                    files.push(FileInfo {
                        path: path.to_string_lossy().to_string(),
                        name: path.file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("")
                            .to_string(),
                        is_file: path.is_file(),
                        size: metadata.as_ref().map(|m| m.len()),
                    });
                }
            }
            Ok(warp::reply::json(&ApiResponse {
                success: true,
                data: Some(files),
                error: None,
            }))
        }
        Err(e) => Ok(warp::reply::json(&ApiResponse::<Vec<FileInfo>> {
            success: false,
            data: None,
            error: Some(e.to_string()),
        })),
    }
}

async fn create_file_or_directory(request: CreateRequest, expected_hash: String) -> Result<impl Reply, Rejection> {
    if let Err(e) = check_auth(&request.token, &expected_hash).await {
        return Ok(warp::reply::json(&ApiResponse::<String> {
            success: false,
            data: None,
            error: Some(e),
        }));
    }
    
    let path = Path::new(&request.path);
    
    let result = if request.is_directory {
        fs::create_dir_all(path)
    } else {
        if let Some(parent) = path.parent() {
            if !parent.exists() {
                if let Err(e) = fs::create_dir_all(parent) {
                    return Ok(warp::reply::json(&ApiResponse::<String> {
                        success: false,
                        data: None,
                        error: Some(format!("Failed to create parent directory: {}", e)),
                    }));
                }
            }
        }
        fs::write(path, "")
    };

    match result {
        Ok(_) => Ok(warp::reply::json(&ApiResponse {
            success: true,
            data: Some(format!("{} created successfully", if request.is_directory { "Directory" } else { "File" })),
            error: None,
        })),
        Err(e) => Ok(warp::reply::json(&ApiResponse::<String> {
            success: false,
            data: None,
            error: Some(e.to_string()),
        })),
    }
}

async fn move_file(request: MoveRequest, expected_hash: String) -> Result<impl Reply, Rejection> {
    if let Err(e) = check_auth(&request.token, &expected_hash).await {
        return Ok(warp::reply::json(&ApiResponse::<String> {
            success: false,
            data: None,
            error: Some(e),
        }));
    }
    
    let source = Path::new(&request.source);
    let destination = Path::new(&request.destination);
    
    if !source.exists() {
        return Ok(warp::reply::json(&ApiResponse::<String> {
            success: false,
            data: None,
            error: Some("Source file does not exist".to_string()),
        }));
    }
    
    if let Some(parent) = destination.parent() {
        if !parent.exists() {
            if let Err(e) = fs::create_dir_all(parent) {
                return Ok(warp::reply::json(&ApiResponse::<String> {
                    success: false,
                    data: None,
                    error: Some(format!("Failed to create destination directory: {}", e)),
                }));
            }
        }
    }

    match fs::rename(source, destination) {
        Ok(_) => Ok(warp::reply::json(&ApiResponse {
            success: true,
            data: Some("File moved successfully".to_string()),
            error: None,
        })),
        Err(e) => Ok(warp::reply::json(&ApiResponse::<String> {
            success: false,
            data: None,
            error: Some(e.to_string()),
        })),
    }
}

async fn copy_file(request: CopyRequest, expected_hash: String) -> Result<impl Reply, Rejection> {
    if let Err(e) = check_auth(&request.token, &expected_hash).await {
        return Ok(warp::reply::json(&ApiResponse::<String> {
            success: false,
            data: None,
            error: Some(e),
        }));
    }
    
    let source = Path::new(&request.source);
    let destination = Path::new(&request.destination);
    
    if !source.exists() {
        return Ok(warp::reply::json(&ApiResponse::<String> {
            success: false,
            data: None,
            error: Some("Source file does not exist".to_string()),
        }));
    }
    
    if let Some(parent) = destination.parent() {
        if !parent.exists() {
            if let Err(e) = fs::create_dir_all(parent) {
                return Ok(warp::reply::json(&ApiResponse::<String> {
                    success: false,
                    data: None,
                    error: Some(format!("Failed to create destination directory: {}", e)),
                }));
            }
        }
    }

    let result = if source.is_dir() {
        copy_dir_recursive(source, destination)
    } else {
        fs::copy(source, destination).map(|_| ())
    };

    match result {
        Ok(_) => Ok(warp::reply::json(&ApiResponse {
            success: true,
            data: Some("File copied successfully".to_string()),
            error: None,
        })),
        Err(e) => Ok(warp::reply::json(&ApiResponse::<String> {
            success: false,
            data: None,
            error: Some(e.to_string()),
        })),
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    if !dst.exists() {
        fs::create_dir_all(dst)?;
    }
    
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

fn generate_token_hash(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    let result = hasher.finalize();
    format!("{:x}", result)
}

async fn start_api_server(config: Config) {
    let token_hash = generate_token_hash(&config.token);
    
    println!("✅ サーバー起動中...");
    
    if let Err(e) = std::net::TcpListener::bind(("127.0.0.1", config.port)) {
        eprintln!("❌ サーバー起動エラー: {}", e);
        eprintln!("ポート {} が既に使用されている可能性があります。", config.port);
        eprintln!("config.json でポート番号を変更するか、以下のコマンドで使用中のプロセスを終了してください:");
        eprintln!("  netstat -ano | findstr :{}", config.port);
        eprintln!("  taskkill /PID <プロセスID> /F");
        return;
    }
    
    println!("✅ サーバー起動成功");

    let cors = warp::cors()
        .allow_any_origin()
        .allow_headers(vec!["content-type"])
        .allow_methods(&[Method::GET, Method::POST, Method::PUT, Method::DELETE]);

    let token_hash_filter = warp::any().map(move || token_hash.clone());

    let read_route = warp::path!("api" / "read")
        .and(warp::post())
        .and(warp::body::json())
        .and(token_hash_filter.clone())
        .and_then(read_file);

    let read_binary_route = warp::path!("api" / "read_binary")
        .and(warp::post())
        .and(warp::body::json())
        .and(token_hash_filter.clone())
        .and_then(read_binary_file);

    let write_route = warp::path!("api" / "write")
        .and(warp::post())
        .and(warp::body::json())
        .and(token_hash_filter.clone())
        .and_then(write_file);

    let write_binary_route = warp::path!("api" / "write_binary")
        .and(warp::post())
        .and(warp::body::json())
        .and(token_hash_filter.clone())
        .and_then(write_binary_file);

    let delete_route = warp::path!("api" / "delete")
        .and(warp::post())
        .and(warp::body::json())
        .and(token_hash_filter.clone())
        .and_then(delete_file);

    let search_route = warp::path!("api" / "search")
        .and(warp::post())
        .and(warp::body::json())
        .and(token_hash_filter.clone())
        .and_then(search_files);

    let list_route = warp::path!("api" / "list")
        .and(warp::get())
        .and(warp::query::<std::collections::HashMap<String, String>>())
        .and(token_hash_filter.clone())
        .and_then(move |query: std::collections::HashMap<String, String>, expected_hash: String| async move {
            let path = query.get("path").cloned().unwrap_or_else(|| ".".to_string());
            let token = query.get("token").cloned().unwrap_or_default();
            list_directory(path, token, expected_hash).await
        });

    let create_route = warp::path!("api" / "create")
        .and(warp::post())
        .and(warp::body::json())
        .and(token_hash_filter.clone())
        .and_then(create_file_or_directory);

    let move_route = warp::path!("api" / "move")
        .and(warp::post())
        .and(warp::body::json())
        .and(token_hash_filter.clone())
        .and_then(move_file);

    let copy_route = warp::path!("api" / "copy")
        .and(warp::post())
        .and(warp::body::json())
        .and(token_hash_filter.clone())
        .and_then(copy_file);

    let health_route = warp::path!("api" / "health")
        .map(|| warp::reply::json(&ApiResponse {
            success: true,
            data: Some("File Agent is running (token required for operations)".to_string()),
            error: None,
        }));

    let routes = read_route
        .or(read_binary_route)
        .or(write_route)
        .or(write_binary_route)
        .or(delete_route)
        .or(search_route)
        .or(list_route)
        .or(create_route)
        .or(move_route)
        .or(copy_route)
        .or(health_route)
        .with(cors);

    warp::serve(routes)
        .run(([127, 0, 0, 1], config.port))
        .await;
}

#[cfg(target_os = "windows")]
fn show_config_dialog(config: Arc<Mutex<Config>>) {
    std::thread::spawn(move || {
        nwg::init().expect("Failed to init Native Windows GUI");
        
        let mut window = Default::default();
        let mut port_input = Default::default();
        let mut token_input = Default::default();
        let mut save_button = Default::default();
        let mut cancel_button = Default::default();
        let mut port_label = Default::default();
        let mut token_label = Default::default();
        
        nwg::Window::builder()
            .size((400, 200))
            .position((300, 300))
            .title("File Agent 設定")
            .build(&mut window)
            .unwrap();
        
        nwg::Label::builder()
            .size((100, 25))
            .position((10, 20))
            .text("ポート:")
            .parent(&window)
            .build(&mut port_label)
            .unwrap();
        
        nwg::TextInput::builder()
            .size((250, 25))
            .position((120, 20))
            .text(&config.lock().unwrap().port.to_string())
            .parent(&window)
            .build(&mut port_input)
            .unwrap();
        
        nwg::Label::builder()
            .size((100, 25))
            .position((10, 60))
            .text("トークン:")
            .parent(&window)
            .build(&mut token_label)
            .unwrap();
        
        nwg::TextInput::builder()
            .size((250, 25))
            .position((120, 60))
            .text(&config.lock().unwrap().token)
            .parent(&window)
            .build(&mut token_input)
            .unwrap();
        
        nwg::Button::builder()
            .size((100, 30))
            .position((90, 120))
            .text("保存")
            .parent(&window)
            .build(&mut save_button)
            .unwrap();
        
        nwg::Button::builder()
            .size((100, 30))
            .position((210, 120))
            .text("キャンセル")
            .parent(&window)
            .build(&mut cancel_button)
            .unwrap();
        
        let window_handle = window.handle;
        let save_handle = save_button.handle;
        let cancel_handle = cancel_button.handle;
        
        let handler = nwg::full_bind_event_handler(&window_handle, move |evt, _evt_data, handle| {
            match evt {
                nwg::Event::OnWindowClose => {
                    nwg::stop_thread_dispatch();
                }
                nwg::Event::OnButtonClick => {
                    if handle == save_handle {
                        if let Ok(port) = port_input.text().parse::<u16>() {
                            let mut cfg = config.lock().unwrap();
                            cfg.port = port;
                            cfg.token = token_input.text();
                            if let Err(e) = cfg.save() {
                                nwg::modal_error_message(&window_handle, "エラー", &format!("設定の保存に失敗しました: {}", e));
                            } else {
                                nwg::modal_info_message(&window_handle, "成功", "設定を保存しました。自動的に再起動します。");
                                nwg::stop_thread_dispatch();
                                // 自動的に再起動
                                restart_application();
                            }
                        } else {
                            nwg::modal_error_message(&window_handle, "エラー", "ポート番号が無効です");
                        }
                    } else if handle == cancel_handle {
                        nwg::stop_thread_dispatch();
                    }
                }
                _ => {}
            }
        });
        
        nwg::dispatch_thread_events();
        nwg::unbind_event_handler(&handler);
    });
}

#[cfg(not(target_os = "windows"))]
fn show_config_dialog(_config: Arc<Mutex<Config>>) {
    println!("設定ダイアログは Windows でのみ利用可能です");
}

fn restart_application() {
    println!("アプリケーションを再起動します...");
    
    let exe_path = std::env::current_exe().unwrap();
    let args: Vec<String> = std::env::args().collect();
    
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new(&exe_path)
            .args(&args[1..])
            .creation_flags(0x00000010) // CREATE_NEW_CONSOLE
            .spawn()
            .expect("Failed to restart application");
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new(&exe_path)
            .args(&args[1..])
            .spawn()
            .expect("Failed to restart application");
    }
    
    std::process::exit(0);
}

fn main() {
    println!("File Agent starting...");
    
    let config = Arc::new(Mutex::new(Config::load()));
    let config_display = config.lock().unwrap().clone();
    let token_hash = generate_token_hash(&config_display.token);
    
    println!("設定:");
    println!("  ポート: {}", config_display.port);
    println!("  トークン: {}", config_display.token);
    println!("  トークンハッシュ: {}", token_hash);
    println!("  API サーバー: http://localhost:{}", config_display.port);
    println!();

    // APIサーバーを別スレッドで起動
    let config_for_server = config_display.clone();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(start_api_server(config_for_server));
    });

    // システムトレイアプリケーションを作成
    let mut app = match Application::new() {
        Ok(app) => {
            println!("✅ システムトレイアプリケーションを作成しました");
            app
        }
        Err(e) => {
            eprintln!("❌ システムトレイの作成に失敗しました: {}", e);
            eprintln!("コンソールモードで実行します。Ctrl+C で終了してください。");
            
            // フォールバック: 単純なループで待機
            loop {
                std::thread::sleep(std::time::Duration::from_secs(1));
            }
        }
    };

    // アイコンを設定（Windows用にはicoファイルを使用）
    let icon_path = if std::path::Path::new("icon.ico").exists() {
        "icon.ico".to_string()
    } else {
        // 実行ファイルと同じディレクトリを確認
        let exe_path = std::env::current_exe().unwrap_or_else(|_| std::path::PathBuf::from("."));
        let exe_dir = exe_path.parent().unwrap_or_else(|| std::path::Path::new("."));
        let icon_in_exe_dir = exe_dir.join("icon.ico");
        if icon_in_exe_dir.exists() {
            println!("アイコンパス: {}", icon_in_exe_dir.display());
            icon_in_exe_dir.to_string_lossy().to_string()
        } else {
            "icon.ico".to_string()
        }
    };
    
    if let Err(e) = app.set_icon_from_file(&icon_path) {
        println!("⚠️ アイコンの設定に失敗しました: {}", e);
        // デフォルトアイコンを設定してみる
        if let Err(e2) = app.set_icon_from_resource(&"IDI_APPLICATION") {
            println!("⚠️ デフォルトアイコンの設定も失敗: {}", e2);
        }
    } else {
        println!("✅ アイコンを設定しました: {}", icon_path);
    }

    // ツールチップを設定
    let _ = app.set_tooltip("File Agent");

    // メニューアイテムを追加
    let config_clone = config.clone();
    if let Err(e) = app.add_menu_item("設定", move |_| {
        println!("設定メニューが選択されました");
        show_config_dialog(config_clone.clone());
        Ok::<_, systray::Error>(())
    }) {
        println!("⚠️ 設定メニューの追加に失敗: {}", e);
    }

    if let Err(e) = app.add_menu_separator() {
        println!("⚠️ セパレーターの追加に失敗: {}", e);
    }

    if let Err(e) = app.add_menu_item("再起動", |_| {
        println!("再起動メニューが選択されました");
        restart_application();
        Ok::<_, systray::Error>(())
    }) {
        println!("⚠️ 再起動メニューの追加に失敗: {}", e);
    }

    if let Err(e) = app.add_menu_item("終了", |window| {
        println!("終了メニューが選択されました");
        window.quit();
        Ok::<_, systray::Error>(())
    }) {
        println!("⚠️ 終了メニューの追加に失敗: {}", e);
    }

    println!("🔧 システムトレイで実行中...");
    println!("   右クリックでメニューが表示されます");

    // イベントループを実行
    app.wait_for_message().unwrap();
}