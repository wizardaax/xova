use std::process::Command;
use std::fs;
use std::path::Path;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const SNELL_VERN_EXE: &str = "C:\\Users\\adz_7\\pipx\\venvs\\snell-vern-matrix\\Scripts\\snell-vern.exe";
const MEMORY_DIR: &str = "C:\\Xova\\memory";

/// Apply CREATE_NO_WINDOW on Windows, no-op elsewhere.
fn no_window(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// Remove <think>...</think> blocks (qwen3 thinking-mode output) from a model
/// reply. Handles unclosed open tags by dropping everything from the first
/// <think> if no </think> matches.
fn strip_think_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    loop {
        match rest.find("<think>") {
            None => {
                out.push_str(rest);
                return out.trim().to_string();
            }
            Some(start) => {
                out.push_str(&rest[..start]);
                let after_open = &rest[start + "<think>".len()..];
                match after_open.find("</think>") {
                    None => return out.trim().to_string(),
                    Some(end) => {
                        rest = &after_open[end + "</think>".len()..];
                    }
                }
            }
        }
    }
}

#[tauri::command]
fn run_command(cmd: String, args: Vec<String>, cwd: Option<String>) -> Result<String, String> {
    let mut command = Command::new("cmd");
    command.arg("/C").arg(&cmd);
    for arg in &args {
        command.arg(arg);
    }

    let project_dir = cwd.unwrap_or_else(|| {
        std::env::current_exe()
            .ok()
            .and_then(|p| {
                let mut dir = p.parent()?.to_path_buf();
                for _ in 0..5 {
                    if dir.join("package.json").exists() {
                        return Some(dir.to_string_lossy().to_string());
                    }
                    dir = dir.parent()?.to_path_buf();
                }
                None
            })
            .unwrap_or_else(|| "C:\\Xova\\app".to_string())
    });

    command.current_dir(&project_dir);
    no_window(&mut command);

    let output = command
        .output()
        .map_err(|e| format!("Failed to run '{}': {}", cmd, e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !stdout.trim().is_empty() {
        Ok(stdout)
    } else if !stderr.trim().is_empty() {
        Ok(stderr)
    } else {
        Ok("Done (no output)".to_string())
    }
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<serde_json::Value>, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    let entries = fs::read_dir(p)
        .map_err(|e| format!("Cannot read directory: {}", e))?;

    let mut items = Vec::new();
    for entry in entries.flatten() {
        let metadata = entry.metadata().ok();
        let is_dir = metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let size = metadata.as_ref().map(|m| if m.is_file() { m.len() } else { 0 }).unwrap_or(0);
        let name = entry.file_name().to_string_lossy().to_string();
        items.push(serde_json::json!({
            "name": name,
            "path": entry.path().to_string_lossy().to_string(),
            "isDir": is_dir,
            "size": size,
        }));
    }

    items.sort_by(|a, b| {
        let a_dir = a["isDir"].as_bool().unwrap_or(false);
        let b_dir = b["isDir"].as_bool().unwrap_or(false);
        b_dir.cmp(&a_dir)
            .then(a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")))
    });

    Ok(items)
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("File not found: {}", path));
    }
    if !p.is_file() {
        return Err(format!("Not a file: {}", path));
    }
    let metadata = fs::metadata(p).map_err(|e| e.to_string())?;
    if metadata.len() > 5_000_000 {
        return Err(format!(
            "File too large ({} KB). Max 5MB.",
            metadata.len() / 1024
        ));
    }
    fs::read_to_string(p).map_err(|e| format!("Cannot read file: {}", e))
}

#[tauri::command]
fn get_drives() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({ "letter": "C:", "label": "System", "root": "C:\\" }),
        serde_json::json!({ "letter": "D:", "label": "External 5TB", "root": "D:\\" }),
        serde_json::json!({ "letter": "G:", "label": "Drive G", "root": "G:\\" }),
    ]
}

#[tauri::command]
fn index_directory(
    path: String,
    max_files: Option<usize>,
    max_bytes: Option<u64>,
) -> Result<Vec<serde_json::Value>, String> {
    let root = Path::new(&path);
    if !root.exists() {
        return Err(format!("Path not found: {}", path));
    }

    let text_exts = [
        "txt", "md", "rs", "ts", "tsx", "js", "jsx", "json", "toml", "yaml", "yml",
        "py", "html", "css", "sh", "bat", "csv", "xml", "env", "gitignore",
        "lock", "cfg", "ini", "log", "sql",
    ];

    let max_f = max_files.unwrap_or(500);
    let max_b = max_bytes.unwrap_or(200_000);
    let mut results = Vec::new();

    fn walk(
        dir: &Path,
        text_exts: &[&str],
        max_f: usize,
        max_b: u64,
        results: &mut Vec<serde_json::Value>,
        depth: usize,
    ) {
        if depth > 8 || results.len() >= max_f { return }
        let Ok(entries) = fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            if results.len() >= max_f { break }
            let p = entry.path();
            let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
            if name.starts_with('.') || name == "node_modules" || name == "target"
                || name == "$RECYCLE.BIN" || name == "System Volume Information" { continue }

            if p.is_dir() {
                walk(&p, text_exts, max_f, max_b, results, depth + 1);
            } else if p.is_file() {
                let ext = p.extension().unwrap_or_default().to_string_lossy().to_lowercase();
                let no_ext_ok = name == ".gitignore" || name == ".env" || name == "Makefile";
                if !text_exts.contains(&ext.as_str()) && !no_ext_ok { continue }
                let Ok(meta) = fs::metadata(&p) else { continue };
                if meta.len() > max_b { continue }
                if let Ok(content) = fs::read_to_string(&p) {
                    results.push(serde_json::json!({
                        "path": p.to_string_lossy().to_string(),
                        "name": name,
                        "content": content,
                        "size": meta.len(),
                    }));
                }
            }
        }
    }

    walk(root, &text_exts, max_f, max_b, &mut results, 0);
    Ok(results)
}

#[tauri::command]
fn dispatch_mesh(task_type: String, args: String) -> Result<String, String> {
    let mut cmd = Command::new(SNELL_VERN_EXE);
    cmd.args(["mesh", "--dispatch", &task_type, &args]);
    no_window(&mut cmd);
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run snell-vern: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !stdout.trim().is_empty() {
        Ok(stdout)
    } else if !stderr.trim().is_empty() {
        Err(stderr)
    } else {
        Ok("Done (no output)".to_string())
    }
}

#[tauri::command]
fn cascade_mesh(task_type: String, args: String) -> Result<String, String> {
    let mut cmd = Command::new(SNELL_VERN_EXE);
    cmd.args(["mesh", "--cascade", &task_type, &args]);
    no_window(&mut cmd);
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run snell-vern: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !stdout.trim().is_empty() {
        Ok(stdout)
    } else if !stderr.trim().is_empty() {
        Err(stderr)
    } else {
        Ok("Done (no output)".to_string())
    }
}

#[tauri::command]
fn mesh_status() -> Result<String, String> {
    let mut cmd = Command::new(SNELL_VERN_EXE);
    cmd.args(["mesh", "--status"]);
    no_window(&mut cmd);
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run snell-vern: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !stdout.trim().is_empty() {
        Ok(stdout)
    } else if !stderr.trim().is_empty() {
        Err(stderr)
    } else {
        Ok("Done (no output)".to_string())
    }
}

#[tauri::command]
fn save_memory(key: String, value: String) -> Result<String, String> {
    if key.is_empty() || key.contains("..") || key.contains('/') || key.contains('\\') {
        return Err(format!("Invalid memory key: {}", key));
    }
    let dir = Path::new(MEMORY_DIR);
    if !dir.exists() {
        fs::create_dir_all(dir).map_err(|e| format!("Cannot create memory dir: {}", e))?;
    }
    let path = dir.join(format!("{}.json", key));
    fs::write(&path, value).map_err(|e| format!("Cannot write memory: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn load_memory(key: String) -> Result<String, String> {
    if key.is_empty() || key.contains("..") || key.contains('/') || key.contains('\\') {
        return Err(format!("Invalid memory key: {}", key));
    }
    let path = Path::new(MEMORY_DIR).join(format!("{}.json", key));
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| format!("Cannot read memory: {}", e))
}

/// Streaming variant of ollama_chat. Each token chunk is emitted as a
/// `chat-token` event with the request_id; final state is `chat-done` with
/// either content or tool_calls. Frontend listens by request_id and appends
/// tokens to the placeholder live. The full reply is also returned at the end
/// so callers that don't listen still get the result.
#[tauri::command]
async fn ollama_chat_stream(
    app: tauri::AppHandle,
    request_id: String,
    messages: String,
    model: Option<String>,
    num_ctx: Option<i64>,
) -> Result<String, String> {
    use tauri::Emitter;
    let client = reqwest::Client::new();
    let mut parsed_messages: serde_json::Value = serde_json::from_str(&messages)
        .map_err(|e| format!("bad messages json: {}", e))?;

    // Same /no_think prefix injection as the sync path.
    if let Some(arr) = parsed_messages.as_array_mut() {
        let already_present = arr.iter().any(|m| {
            m.get("role").and_then(|r| r.as_str()) == Some("system")
                && m.get("content").and_then(|c| c.as_str()) == Some("/no_think")
        });
        if !already_present {
            arr.insert(0, serde_json::json!({"role": "system", "content": "/no_think"}));
        }
    }

    let chosen_model = model.filter(|s| !s.is_empty()).unwrap_or_else(|| "llama3.2:3b".to_string());
    let chosen_ctx = num_ctx.filter(|n| *n > 0).unwrap_or(4096);

    let mut options_map = serde_json::Map::new();
    options_map.insert("num_ctx".into(), serde_json::Value::from(chosen_ctx));
    options_map.insert("temperature".into(), serde_json::Value::from(0.3));

    let body = serde_json::json!({
        "model": chosen_model,
        "messages": parsed_messages,
        "stream": true,
        "options": options_map,
        "keep_alive": "1h",
        "think": false,
    });

    let resp = client
        .post("http://localhost:11434/api/chat")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama unreachable: {}", e))?;

    let mut accumulated_content = String::new();
    let mut final_tool_calls: Option<serde_json::Value> = None;

    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();
    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("stream chunk err: {}", e))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        // Ollama's chat stream is one JSON object per line. Process complete lines.
        while let Some(nl_pos) = buffer.find('\n') {
            let line = buffer[..nl_pos].to_string();
            buffer.drain(..=nl_pos);
            let line_trim = line.trim();
            if line_trim.is_empty() { continue; }
            let json: serde_json::Value = match serde_json::from_str(line_trim) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if let Some(msg) = json.get("message") {
                if let Some(token) = msg.get("content").and_then(|c| c.as_str()) {
                    if !token.is_empty() {
                        accumulated_content.push_str(token);
                        let _ = app.emit("chat-token", serde_json::json!({
                            "request_id": request_id,
                            "token": token,
                        }));
                    }
                }
                if let Some(tc) = msg.get("tool_calls") {
                    if !tc.is_null() && tc.as_array().map(|a| !a.is_empty()).unwrap_or(false) {
                        final_tool_calls = Some(tc.clone());
                    }
                }
            }
            if json.get("done").and_then(|d| d.as_bool()).unwrap_or(false) {
                break;
            }
        }
    }

    // Strip <think>...</think> from accumulated content, defensive.
    let cleaned = strip_think_tags(&accumulated_content);

    let final_payload = if let Some(tc) = final_tool_calls {
        serde_json::json!({"type": "tool_calls", "calls": tc})
    } else {
        serde_json::json!({"type": "content", "text": cleaned})
    };
    let final_str = final_payload.to_string();
    let _ = app.emit("chat-done", serde_json::json!({
        "request_id": request_id,
        "result": final_payload,
    }));
    Ok(final_str)
}

#[tauri::command]
async fn ollama_chat(
    messages: String,
    model: Option<String>,
    num_ctx: Option<i64>,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    // XOVA_OLLAMA_REQ_BUILDER_v3 â€” tool calling enabled
    let mut parsed_messages: serde_json::Value = serde_json::from_str(&messages)
        .map_err(|e| format!("bad messages json: {}", e))?;
    let chosen_model = model.filter(|s| !s.is_empty()).unwrap_or_else(|| "llama3.2:3b".to_string());
    let chosen_ctx = num_ctx.filter(|n| *n > 0).unwrap_or(4096);
    // qwen3 native directive: prepend a dedicated system message containing
    // ONLY "/no_think". Putting it inside an existing system prompt caused the
    // model to echo it into tool-call arguments (observed: task="jarvis /no_think").
    // Keeping it as its own message makes qwen3 treat it as a directive, not content.
    if let Some(arr) = parsed_messages.as_array_mut() {
        let already_present = arr.iter().any(|m| {
            m.get("role").and_then(|r| r.as_str()) == Some("system")
                && m.get("content").and_then(|c| c.as_str()) == Some("/no_think")
        });
        if !already_present {
            arr.insert(0, serde_json::json!({"role": "system", "content": "/no_think"}));
        }
    }
    let mut options_map = serde_json::Map::new();
    options_map.insert(String::from("num_ctx"), serde_json::Value::from(chosen_ctx));
    options_map.insert(String::from("temperature"), serde_json::Value::from(0.3f64));
    let tools = serde_json::json!([
        {"type":"function","function":{"name":"dispatch_mesh","description":"Mesh task → ONE repo (highest coherence).","parameters":{"type":"object","properties":{"task_type":{"type":"string"},"args":{"type":"string"}},"required":["task_type"]}}},
        {"type":"function","function":{"name":"cascade_mesh","description":"Mesh task → ALL repos that support it (broadcast).","parameters":{"type":"object","properties":{"task_type":{"type":"string"},"args":{"type":"string"}},"required":["task_type"]}}},
        {"type":"function","function":{"name":"run_plugin","description":"Run an existing .py plugin in C:\\Xova\\plugins. NOT for shell commands.","parameters":{"type":"object","properties":{"name":{"type":"string","description":"plugin filename, e.g. 'my_recursive_ai.py'"}},"required":["name"]}}},
        {"type":"function","function":{"name":"xova_read_codex","description":"Read Adam's Codex laws.","parameters":{"type":"object","properties":{}}}},
        {"type":"function","function":{"name":"xova_speak","description":"Speak text via TTS.","parameters":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}}},
        {"type":"function","function":{"name":"xova_jarvis","description":"Multi-step autonomous computer task (>2 actions).","parameters":{"type":"object","properties":{"task":{"type":"string"}},"required":["task"]}}},
        {"type":"function","function":{"name":"xova_read_file","description":"Read any file. No path restrictions.","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}},
        {"type":"function","function":{"name":"xova_list_dir","description":"List any directory.","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}},
        {"type":"function","function":{"name":"xova_write_file","description":"Write/overwrite any file (creates parent dirs).","parameters":{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]}}},
        {"type":"function","function":{"name":"xova_delete_path","description":"Delete a file or directory (recursive).","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}},
        {"type":"function","function":{"name":"xova_run","description":"Run any shell command via cmd.exe. Use for opening apps, terminals, CLIs. Set elevated=true for admin (UAC).","parameters":{"type":"object","properties":{"command":{"type":"string"},"cwd":{"type":"string"},"elevated":{"type":"boolean"}},"required":["command"]}}},
        {"type":"function","function":{"name":"xova_ask_jarvis","description":"Delegate to Jarvis butler. Use for: scheduling, reminders, conversational chat, weather, meal logging, web search via Jarvis, anything butler-tone. Jarvis's reply lands in chat as a 🎙 jarvis message.","parameters":{"type":"object","properties":{"text":{"type":"string","description":"What to ask Jarvis"}},"required":["text"]}}},
        {"type":"function","function":{"name":"xova_list_plugins","description":"List available plugins.","parameters":{"type":"object","properties":{}}}},
        {"type":"function","function":{"name":"xova_list_repos","description":"List wizardaax repos.","parameters":{"type":"object","properties":{}}}},
        {"type":"function","function":{"name":"xova_computer","description":"Computer control. action is JSON string with 'cmd' field. cmds: screenshot, screen_size, mouse_pos, move, click, right_click, double_click, drag, scroll, type, press, hotkey, open, run, speak, listen, windows, focus_window, close_window, minimize_window, maximize_window, wait, browser, search.","parameters":{"type":"object","properties":{"action":{"type":"string"}},"required":["action"]}}},
        {"type":"function","function":{"name":"xova_vision","description":"Describe an image (auto-runs after screenshot — usually you don't call directly).","parameters":{"type":"object","properties":{"image_path":{"type":"string"},"prompt":{"type":"string"}},"required":["image_path"]}}},
        {"type":"function","function":{"name":"xova_field","description":"Ziltrix ternary field math. Use only for explicit math/coherence/sequence questions, not greetings.","parameters":{"type":"object","properties":{"input":{"type":"string"}},"required":["input"]}}},
        {"type":"function","function":{"name":"xova_build_tool","description":"Install a new tool. target='xova_plugin' (C:\\Xova\\plugins, run() function) or 'jarvis_tool' (Tool subclass body, auto-loaded). py_compile + atomic install only.","parameters":{"type":"object","properties":{"target":{"type":"string","enum":["xova_plugin","jarvis_tool"]},"name":{"type":"string"},"spec":{"type":"string"},"source":{"type":"string"},"class_name":{"type":"string"},"tool_name":{"type":"string"}},"required":["name","spec","source"]}}}
    ]);
    let mut body_map = serde_json::Map::new();
    body_map.insert(String::from("model"), serde_json::Value::from(chosen_model));
    body_map.insert(String::from("messages"), parsed_messages);
    body_map.insert(String::from("stream"), serde_json::Value::Bool(false));
    body_map.insert(String::from("options"), serde_json::Value::Object(options_map));
    body_map.insert(String::from("tools"), tools);
    // Keep the model resident in VRAM for an hour. Ollama's default 5-minute
    // keep_alive forces a ~37s cold reload on every gap >5min, which was the
    // single biggest source of perceived lag.
    body_map.insert(String::from("keep_alive"), serde_json::Value::from("1h"));
    // Disable qwen3's thinking mode. Otherwise it emits <think>...</think>
    // reasoning tokens before answering, which on slow hardware looks like
    // the model is hung — it's just thinking out loud at 3.9 tok/s.
    body_map.insert(String::from("think"), serde_json::Value::Bool(false));
    let body = serde_json::Value::Object(body_map);
    let resp = client
        .post("http://localhost:11434/api/chat")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama unreachable: {}. Is `ollama serve` running?", e))?;
    let json: serde_json::Value = resp.json().await.map_err(|e| format!("Bad Ollama response: {}", e))?;
    let message = json
        .get("message")
        .ok_or_else(|| format!("No message in response: {}", json))?;

    if let Some(tool_calls) = message.get("tool_calls").and_then(|t| t.as_array()) {
        if !tool_calls.is_empty() {
            let out = serde_json::json!({
                "type": "tool_calls",
                "calls": tool_calls,
            });
            return serde_json::to_string(&out).map_err(|e| e.to_string());
        }
    }

    let raw_content = message
        .get("content")
        .and_then(|c| c.as_str())
        .ok_or_else(|| format!("No content in response: {}", json))?;
    // Defensive: strip <think>...</think> blocks. With think:false set above
    // this should never fire, but older Ollama versions ignore the flag and
    // qwen3 happily fills the response with reasoning tokens otherwise.
    let stripped = strip_think_tags(raw_content);
    let content: &str = &stripped;

    // Some Ollama models leak tool-call JSON into the content string instead of
    // the structured tool_calls field. Detect both shapes and route as tool_calls
    // so the frontend can dispatch the tool instead of rendering raw JSON.
    //   Ollama shape:  {"function": {"name": "...", "arguments": {...}}}
    //   OpenAI shape:  {"name": "...", "parameters": {...}}  (or "arguments")
    let trimmed = content.trim();
    if trimmed.starts_with('[') || trimmed.starts_with('{') {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
            let raw_array: Option<Vec<serde_json::Value>> = if parsed.is_array() {
                Some(parsed.as_array().unwrap().clone())
            } else if parsed.is_object() {
                Some(vec![parsed.clone()])
            } else {
                None
            };
            // Normalize each candidate object to the Ollama shape if it looks
            // like a tool call. Returns None if any element doesn't match.
            let normalized: Option<Vec<serde_json::Value>> = raw_array.and_then(|arr| {
                if arr.is_empty() { return None; }
                let mut out = Vec::with_capacity(arr.len());
                for c in arr {
                    let obj = match c.as_object() { Some(o) => o, None => return None };
                    // Ollama shape — already correct
                    if let Some(fn_obj) = obj.get("function").and_then(|f| f.as_object()) {
                        if fn_obj.get("name").and_then(|n| n.as_str()).is_some() {
                            out.push(c.clone());
                            continue;
                        }
                    }
                    // OpenAI shape — wrap into Ollama envelope
                    if let Some(name) = obj.get("name").and_then(|n| n.as_str()) {
                        let args = obj.get("arguments")
                            .or_else(|| obj.get("parameters"))
                            .cloned()
                            .unwrap_or_else(|| serde_json::json!({}));
                        out.push(serde_json::json!({
                            "function": {"name": name, "arguments": args}
                        }));
                        continue;
                    }
                    return None;
                }
                Some(out)
            });
            if let Some(arr) = normalized {
                let out = serde_json::json!({
                    "type": "tool_calls",
                    "calls": arr,
                });
                return serde_json::to_string(&out).map_err(|e| e.to_string());
            }
        }
    }

    let out = serde_json::json!({
        "type": "content",
        "text": content,
    });
    serde_json::to_string(&out).map_err(|e| e.to_string())
}

#[tauri::command]
fn xova_read_codex() -> Result<String, String> {
    std::fs::read_to_string("C:\\Xova\\app\\Codex.md").map_err(|e| e.to_string())
}

#[tauri::command]
fn xova_read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn xova_list_dir(path: String) -> Result<Vec<String>, String> {
    let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for entry in entries.flatten() {
        if let Some(name) = entry.file_name().to_str() {
            out.push(name.to_string());
        }
    }
    Ok(out)
}

#[tauri::command]
fn xova_write_file(path: String, content: String) -> Result<String, String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            let _ = std::fs::create_dir_all(parent);
        }
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(path)
}

#[tauri::command]
fn xova_delete_path(path: String) -> Result<String, String> {
    let p = std::path::Path::new(&path);
    if p.is_dir() {
        std::fs::remove_dir_all(p).map_err(|e| e.to_string())?;
    } else {
        std::fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(path)
}

/// Send a Windows toast notification via PowerShell + BurntToast-equivalent
/// XML directly through the WinRT API. Falls back to a console msg on failure.
#[tauri::command]
fn xova_notify(title: String, message: String) -> Result<String, String> {
    let safe_title = title.replace('"', "''").replace('\n', " ");
    let safe_msg = message.replace('"', "''").replace('\n', " ");
    let ps = format!(
        r#"$xml = '<toast><visual><binding template="ToastGeneric"><text>{}</text><text>{}</text></binding></visual></toast>';
$doc = New-Object Windows.Data.Xml.Dom.XmlDocument;
$doc.LoadXml($xml);
$toast = New-Object Windows.UI.Notifications.ToastNotification $doc;
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Xova').Show($toast);"#,
        safe_title, safe_msg,
    );
    let mut cmd = Command::new("powershell.exe");
    cmd.args([
        "-NoProfile",
        "-Command",
        &format!("[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime] | Out-Null; {}", ps),
    ]);
    no_window(&mut cmd);
    let output = cmd.output().map_err(|e| format!("toast spawn failed: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("toast failed: {}", stderr.trim()));
    }
    Ok("ok".to_string())
}

/// Persist or list reminders. Reminders are stored as a JSON array in
/// C:\Xova\memory\reminders.json. The poller (frontend) checks every 30s for
/// fired reminders and emits a toast.
#[tauri::command]
fn xova_reminders_list() -> Result<String, String> {
    let p = Path::new(MEMORY_DIR).join("reminders.json");
    if !p.exists() { return Ok("[]".to_string()); }
    fs::read_to_string(&p).map_err(|e| e.to_string())
}

#[tauri::command]
fn xova_reminders_save(json: String) -> Result<String, String> {
    let dir = Path::new(MEMORY_DIR);
    if !dir.exists() {
        fs::create_dir_all(dir).map_err(|e| format!("Cannot create memory dir: {}", e))?;
    }
    let p = dir.join("reminders.json");
    fs::write(&p, json).map_err(|e| e.to_string())?;
    Ok("ok".to_string())
}

/// Save a base64-encoded upload to C:\Xova\memory\uploads\<ts>-<name>.
/// Returns the saved path so the caller can pass it to vision / extract / etc.
#[tauri::command]
fn xova_save_upload(filename: String, base64_data: String) -> Result<String, String> {
    use base64::Engine;
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return Err("invalid filename".to_string());
    }
    let dir = Path::new(MEMORY_DIR).join("uploads");
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir: {}", e))?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let safe = filename.chars().filter(|c| c.is_ascii_alphanumeric() || ".-_ ".contains(*c)).collect::<String>();
    let p = dir.join(format!("{}-{}", ts, safe.trim()));
    let bytes = base64::engine::general_purpose::STANDARD.decode(base64_data.as_bytes())
        .map_err(|e| format!("b64 decode: {}", e))?;
    fs::write(&p, bytes).map_err(|e| format!("write: {}", e))?;
    Ok(p.to_string_lossy().to_string())
}

/// Extract plain text from a file. Routes by extension:
///   .txt/.md/.json/.py/.rs/.ts/.tsx/.js/.html/.css/.csv/.log → read raw
///   .pdf → pymupdf (via Jarvis venv python)
///   .docx → python-docx
///   anything else → return error
#[tauri::command]
fn xova_extract_text(path: String) -> Result<String, String> {
    let p = std::path::Path::new(&path);
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let text_exts = ["txt","md","markdown","json","yml","yaml","toml","py","rs","ts","tsx","js","jsx","html","htm","css","csv","log","sh","bash","ps1","bat","go","java","cpp","c","h","hpp","conf","cfg","ini","xml"];
    if text_exts.contains(&ext.as_str()) {
        let raw = fs::read_to_string(p).map_err(|e| e.to_string())?;
        return Ok(raw);
    }
    if ext == "pdf" || ext == "docx" {
        let py_script = if ext == "pdf" {
            format!(r#"
import sys
try:
    import fitz
    doc = fitz.open(r'{}')
    print('\n'.join(p.get_text() for p in doc))
except Exception as e:
    print(f'EXTRACT_ERROR: {{e}}', file=sys.stderr)
    sys.exit(1)
"#, path.replace('\'', "''"))
        } else {
            format!(r#"
import sys
try:
    import docx
    d = docx.Document(r'{}')
    print('\n'.join(p.text for p in d.paragraphs))
except Exception as e:
    print(f'EXTRACT_ERROR: {{e}}', file=sys.stderr)
    sys.exit(1)
"#, path.replace('\'', "''"))
        };
        let mut cmd = Command::new(r"C:\jarvis\.venv\Scripts\python.exe");
        cmd.args(["-c", &py_script]);
        no_window(&mut cmd);
        let out = cmd.output().map_err(|e| format!("python: {}", e))?;
        if !out.status.success() {
            return Err(format!("extract failed: {}", String::from_utf8_lossy(&out.stderr).trim()));
        }
        return Ok(String::from_utf8_lossy(&out.stdout).to_string());
    }
    Err(format!("unsupported extension: .{}", ext))
}

/// Append a chat-format export (markdown) to the path. Returns the saved path.
#[tauri::command]
fn xova_export_chat(content: String, format: String) -> Result<String, String> {
    let dir = Path::new(MEMORY_DIR).join("exports");
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir: {}", e))?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let ext = if format == "json" { "json" } else { "md" };
    let p = dir.join(format!("xova-chat-{}.{}", chrono_like_now(ts), ext));
    fs::write(&p, content).map_err(|e| format!("write: {}", e))?;
    Ok(p.to_string_lossy().to_string())
}

/// Read what Jarvis knows about the user from his SQLite memory graph.
/// Returns the top N nodes by access_count (most-touched facts) so the user
/// can see — and via xova_memory_delete — prune what's stuck in there.
#[tauri::command]
fn xova_memory_list(limit: Option<u32>) -> Result<String, String> {
    let lim = limit.unwrap_or(60);
    let py = format!(
        r#"
import sqlite3, json, os
p = os.path.join(os.path.expanduser('~'), '.local', 'share', 'jarvis', 'jarvis.db')
if not os.path.exists(p):
    print('[]')
else:
    c = sqlite3.connect(f'file:{{p}}?mode=ro', uri=True)
    cur = c.cursor()
    rows = list(cur.execute(
        'SELECT id, name, description, data, parent_id, access_count, last_accessed, created_at, updated_at, data_token_count FROM memory_nodes ORDER BY access_count DESC, last_accessed DESC LIMIT {}'
    ))
    out = []
    for r in rows:
        out.append({{
            'id': r[0], 'name': r[1], 'description': r[2],
            'data': (r[3] or '')[:600],
            'parent_id': r[4], 'access_count': r[5],
            'last_accessed': r[6], 'created_at': r[7], 'updated_at': r[8],
            'data_token_count': r[9],
        }})
    print(json.dumps(out))
"#,
        lim
    );
    let mut cmd = Command::new(r"C:\jarvis\.venv\Scripts\python.exe");
    cmd.args(["-c", &py]);
    no_window(&mut cmd);
    let out = cmd.output().map_err(|e| format!("python spawn: {}", e))?;
    if !out.status.success() {
        return Err(format!("memory list failed: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

#[tauri::command]
fn xova_memory_delete(id: String) -> Result<String, String> {
    if id.is_empty() || id.len() > 200 || id.contains('\'') {
        return Err("invalid id".to_string());
    }
    let py = format!(
        r#"
import sqlite3, os, json
p = os.path.join(os.path.expanduser('~'), '.local', 'share', 'jarvis', 'jarvis.db')
c = sqlite3.connect(p)
cur = c.cursor()
cur.execute("DELETE FROM memory_nodes WHERE id = ?", ('{}',))
c.commit()
print(json.dumps({{'deleted': cur.rowcount}}))
"#,
        id.replace('\'', "''")
    );
    let mut cmd = Command::new(r"C:\jarvis\.venv\Scripts\python.exe");
    cmd.args(["-c", &py]);
    no_window(&mut cmd);
    let out = cmd.output().map_err(|e| format!("python spawn: {}", e))?;
    if !out.status.success() {
        return Err(format!("memory delete failed: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// Run the speaker-id enrollment script — records 30s from the default mic,
/// computes a single embedding, freezes the voice profile. Run this AFTER
/// closing tabs / muting other audio so the embedding is clean. Blocks for
/// ~30s of recording + a few seconds of model load.
#[tauri::command]
fn xova_enroll_voice(seconds: Option<u64>) -> Result<String, String> {
    let secs = seconds.unwrap_or(30);
    let ps_script = format!(
        r#"
import sys
sys.path.insert(0, r'C:\jarvis\src')
from jarvis.listening.speaker_id import enroll_from_recording
import json
print(json.dumps(enroll_from_recording({})))
"#,
        secs as f64
    );
    let mut cmd = Command::new(r"C:\jarvis\.venv\Scripts\python.exe");
    cmd.args(["-c", &ps_script]);
    no_window(&mut cmd);
    let output = cmd.output().map_err(|e| format!("spawn failed: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        return Err(format!("enrollment failed (exit {}): {}", output.status.code().unwrap_or(-1), stderr.trim()));
    }
    // The script prints a JSON blob on the last line.
    let last_line = stdout.lines().rev().find(|l| l.trim().starts_with('{')).unwrap_or("");
    Ok(last_line.to_string())
}

/// Backup C:\Xova\memory\ to a timestamped folder under D:\Xova\backups\.
/// Cheap insurance: chat history, reminders, settings, voice profile, plugins.
#[tauri::command]
fn xova_backup() -> Result<String, String> {
    use std::time::SystemTime;
    let ts = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let now = chrono_like_now(ts);
    let dst_root = format!("D:\\Xova\\backups\\{}", now);
    if let Err(e) = fs::create_dir_all(&dst_root) {
        return Err(format!("create dst: {}", e));
    }
    let copies: Vec<(&str, &str)> = vec![
        ("C:\\Xova\\memory", "memory"),
        ("C:\\Xova\\plugins", "plugins"),
        ("C:\\Xova\\app\\Codex.md", "Codex.md"),
    ];
    let mut report: Vec<String> = Vec::new();
    for (src, name) in copies {
        let dst = format!("{}\\{}", dst_root, name);
        // Use robocopy for dirs, copy for files
        let src_path = std::path::Path::new(src);
        if !src_path.exists() {
            report.push(format!("  skip {} (missing)", name));
            continue;
        }
        if src_path.is_dir() {
            let mut cmd = Command::new("robocopy");
            cmd.args([src, &dst, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP"]);
            no_window(&mut cmd);
            let _ = cmd.output();
            report.push(format!("  copied dir {} → {}", name, &dst));
        } else {
            if let Err(e) = fs::copy(src, &dst) {
                report.push(format!("  copy file {} failed: {}", name, e));
            } else {
                report.push(format!("  copied file {} → {}", name, &dst));
            }
        }
    }
    Ok(serde_json::json!({
        "destination": dst_root,
        "report": report,
    }).to_string())
}

fn chrono_like_now(ts: u64) -> String {
    // Format YYYY-MM-DD_HH-mm-ss from epoch seconds without pulling in chrono.
    let secs = ts as i64;
    let days = secs / 86400;
    let h = ((secs % 86400) / 3600) as u32;
    let m = ((secs % 3600) / 60) as u32;
    let s = (secs % 60) as u32;
    // Convert days from epoch to civil date (Howard Hinnant algorithm).
    let z = days + 719468;
    let era = if z >= 0 { z / 146097 } else { (z - 146096) / 146097 };
    let doe = (z - era * 146097) as i64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m_civil = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    let y_civil = (y + if m_civil <= 2 { 1 } else { 0 }) as i64;
    format!("{:04}-{:02}-{:02}_{:02}-{:02}-{:02}", y_civil, m_civil, d, h, m, s)
}

/// Send text to your phone's clipboard via Windows clipboard sync (works when
/// Phone Link cross-device clipboard is enabled). Best-effort — no programmatic
/// way to target a specific paired phone, so it goes to whichever is active.
#[tauri::command]
fn xova_send_to_phone(text: String) -> Result<String, String> {
    let escaped = text.replace('\'', "''");
    let ps = format!("Set-Clipboard -Value '{}'", escaped);
    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-Command", &ps]);
    no_window(&mut cmd);
    let out = cmd.output().map_err(|e| format!("clipboard set failed: {}", e))?;
    if !out.status.success() {
        return Err(format!("clipboard error: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok("text copied to PC clipboard — if Phone Link clipboard sync is on, it'll appear on your phone in a few seconds".to_string())
}

/// Quick health snapshot for the status panel — Xova self, Jarvis presence,
/// Ollama loaded model + free VRAM, mesh repo count, recent activity.
#[tauri::command]
fn xova_status() -> Result<String, String> {
    use std::time::Duration;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| format!("client build: {}", e))?;

    // Ollama: which models are loaded + VRAM
    let mut ollama_alive = false;
    let mut loaded_models: Vec<serde_json::Value> = Vec::new();
    if let Ok(resp) = client.get("http://localhost:11434/api/ps").send() {
        if let Ok(j) = resp.json::<serde_json::Value>() {
            ollama_alive = true;
            if let Some(arr) = j.get("models").and_then(|v| v.as_array()) {
                for m in arr {
                    loaded_models.push(serde_json::json!({
                        "name": m.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                        "vram_gb": m.get("size_vram").and_then(|v| v.as_u64()).unwrap_or(0) as f64 / 1e9,
                        "size_gb": m.get("size").and_then(|v| v.as_u64()).unwrap_or(0) as f64 / 1e9,
                    }));
                }
            }
        }
    }

    // Jarvis presence: pythonw process holding a path containing 'jarvis'
    let mut jarvis_alive = false;
    let ps = "Get-Process pythonw -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*jarvis*' } | Select-Object -First 1 -ExpandProperty Id";
    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-Command", ps]);
    no_window(&mut cmd);
    if let Ok(out) = cmd.output() {
        let s = String::from_utf8_lossy(&out.stdout);
        jarvis_alive = !s.trim().is_empty();
    }

    // GPU free VRAM via nvidia-smi (if present)
    let mut gpu_used_mb: i64 = -1;
    let mut gpu_free_mb: i64 = -1;
    let mut cmd2 = Command::new("nvidia-smi");
    cmd2.args(["--query-gpu=memory.used,memory.free", "--format=csv,noheader,nounits"]);
    no_window(&mut cmd2);
    if let Ok(out) = cmd2.output() {
        let s = String::from_utf8_lossy(&out.stdout);
        let line = s.lines().next().unwrap_or("");
        let parts: Vec<&str> = line.split(',').map(|s| s.trim()).collect();
        if parts.len() >= 2 {
            gpu_used_mb = parts[0].parse().unwrap_or(-1);
            gpu_free_mb = parts[1].parse().unwrap_or(-1);
        }
    }

    Ok(serde_json::json!({
        "ts": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0),
        "xova": { "alive": true },
        "jarvis": { "alive": jarvis_alive },
        "ollama": { "alive": ollama_alive, "loaded": loaded_models },
        "gpu": { "used_mb": gpu_used_mb, "free_mb": gpu_free_mb },
    }).to_string())
}

/// Send a request to Jarvis butler via the inbox bridge.
/// Drops a JSON record into C:\Xova\memory\jarvis_inbox.json which the
/// XovaInboxListener thread inside Jarvis picks up within ~2s and routes
/// through Jarvis's reply engine. Jarvis's reply lands back in
/// voice_inbox.json which Xova polls — so the user sees the round trip
/// in chat as their question + Jarvis's answer.
/// List paired Phone Link mobile devices + their Bluetooth connection state.
/// Reads:
///   1. Phone Link's DeviceMetadataStorage.json for the canonical paired list
///   2. PowerShell `Get-PnpDevice` for live Bluetooth presence
/// Returns a JSON array of {id, name, linked, bluetooth_present} so the
/// frontend can show a real device picker instead of asking the user to type.
#[tauri::command]
fn xova_list_phones() -> Result<String, String> {
    let mut out: Vec<serde_json::Value> = Vec::new();

    // 1. Phone Link metadata
    let userprofile = std::env::var("LOCALAPPDATA")
        .map_err(|e| format!("LOCALAPPDATA: {}", e))?;
    let pl_path = std::path::Path::new(&userprofile)
        .join("Packages")
        .join("Microsoft.YourPhone_8wekyb3d8bbwe")
        .join("LocalCache")
        .join("DeviceMetadataStorage.json");
    // Phone Link nests MANY devices as a list under one outer master ID.
    // Iterate every entry, not just the first.
    let mut phone_link_devices: Vec<(String, String, bool)> = Vec::new(); // (guid, display_name, linked)
    if let Ok(raw) = std::fs::read_to_string(&pl_path) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(map) = json.get("DeviceMetadatas").and_then(|v| v.as_object()) {
                for (_master_id, entries) in map {
                    if let Some(arr) = entries.as_array() {
                        for entry in arr {
                            let linked = entry.get("IsLinked").and_then(|v| v.as_bool()).unwrap_or(false);
                            let outer_meta = entry.get("Metadata").and_then(|v| v.as_object());
                            let guid = outer_meta
                                .and_then(|m| m.get("Id"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let inner_meta = outer_meta
                                .and_then(|m| m.get("Metadata"))
                                .and_then(|v| v.as_object());
                            let name = inner_meta
                                .and_then(|m| m.get("DisplayName"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let model = inner_meta
                                .and_then(|m| m.get("ModelName"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            let display = if name.is_empty() && !model.is_empty() {
                                model.to_string()
                            } else if !name.is_empty() && !model.is_empty() {
                                format!("{} ({})", name, model)
                            } else if !name.is_empty() {
                                name
                            } else {
                                continue;
                            };
                            phone_link_devices.push((guid, display, linked));
                        }
                    }
                }
            }
        }
    }

    // 2. Bluetooth-present phones (filter Galaxy/SM-/Pixel/iPhone names, drop service entries)
    let mut bt_names: Vec<String> = Vec::new();
    let ps = "Get-PnpDevice -PresentOnly | Where-Object { ($_.Class -eq 'Bluetooth' -or $_.Class -eq 'System') -and $_.FriendlyName -match 'Galaxy|SM-|Pixel|iPhone|S23|S24|S25|S26' -and $_.FriendlyName -notmatch 'Avrcp|A2DP|Hands-Free|Handsfree|Service|Profile|Enumerator' } | Select-Object -ExpandProperty FriendlyName -Unique";
    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-Command", ps]);
    no_window(&mut cmd);
    if let Ok(output) = cmd.output() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let t = line.trim();
            if !t.is_empty() {
                bt_names.push(t.to_string());
            }
        }
    }

    // Use Phone Link's own DisplayName for each device — that's what shows
    // in Phone Link's UI ("Adam's S23 Ultra", "Adam's Tab S9 FE", etc.).
    for (guid, name, linked) in &phone_link_devices {
        out.push(serde_json::json!({
            "id": guid,
            "name": name,
            "linked": linked,
            "source": "phone-link",
        }));
    }
    // Add any BT-only phones not surfaced by Phone Link.
    for n in &bt_names {
        let already = out.iter().any(|o| {
            o.get("name").and_then(|v| v.as_str()).map(|s| s.starts_with(n.as_str()) || n.contains(s)).unwrap_or(false)
        });
        if !already {
            out.push(serde_json::json!({
                "id": format!("bt:{}", n),
                "name": n,
                "linked": false,
                "source": "bluetooth-only",
            }));
        }
    }

    serde_json::to_string(&out).map_err(|e| e.to_string())
}

#[tauri::command]
fn xova_ask_jarvis(text: String) -> Result<String, String> {
    let dir = Path::new(MEMORY_DIR);
    if !dir.exists() {
        fs::create_dir_all(dir).map_err(|e| format!("Cannot create memory dir: {}", e))?;
    }
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let payload = serde_json::json!({
        "role": "user",
        "text": text,
        "ts": ts,
        "from": "xova",
    });
    let path = dir.join("jarvis_inbox.json");
    fs::write(&path, payload.to_string())
        .map_err(|e| format!("Cannot write jarvis_inbox: {}", e))?;
    Ok(serde_json::json!({"sent": true, "ts": ts}).to_string())
}

#[tauri::command]
fn xova_run(command: String, cwd: Option<String>, elevated: Option<bool>) -> Result<String, String> {
    if elevated.unwrap_or(false) {
        // Launch elevated via PowerShell Start-Process -Verb RunAs. This pops UAC.
        // Output cannot be captured (separate elevated process); return launch status.
        let cwd_clause = match cwd.as_ref().filter(|s| !s.is_empty()) {
            Some(d) => format!(" -WorkingDirectory '{}'", d.replace('\'', "''")),
            None => String::new(),
        };
        let escaped = command.replace('\'', "''");
        let ps = format!(
            "Start-Process -Verb RunAs -FilePath cmd.exe -ArgumentList '/K','{}'{}",
            escaped, cwd_clause
        );
        let mut cmd = Command::new("powershell.exe");
        cmd.args(["-NoProfile", "-Command", &ps]);
        no_window(&mut cmd);
        let output = cmd.output().map_err(|e| format!("elevated spawn failed: {}", e))?;
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        if !output.status.success() {
            return Err(format!("UAC declined or spawn failed: {}", stderr.trim()));
        }
        return Ok(serde_json::json!({
            "exit": 0,
            "stdout": "elevated process launched (output not captured)",
            "stderr": "",
            "elevated": true,
        }).to_string());
    }

    let mut cmd = Command::new("cmd");
    cmd.arg("/C").arg(&command);
    if let Some(d) = cwd.as_ref().filter(|s| !s.is_empty()) {
        cmd.current_dir(d);
    }
    no_window(&mut cmd);
    let output = cmd.output().map_err(|e| format!("spawn failed: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit = output.status.code().unwrap_or(-1);
    Ok(serde_json::json!({
        "exit": exit,
        "stdout": stdout,
        "stderr": stderr,
    }).to_string())
}

#[tauri::command]
fn xova_list_plugins() -> Result<Vec<String>, String> {
    let entries = std::fs::read_dir("C:\\Xova\\plugins").map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for entry in entries.flatten() {
        if let Some(name) = entry.file_name().to_str() {
            if name.ends_with(".py") { out.push(name.to_string()); }
        }
    }
    Ok(out)
}

#[tauri::command]
fn xova_list_repos() -> Result<Vec<String>, String> {
    let entries = std::fs::read_dir("D:\\github\\wizardaax").map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for entry in entries.flatten() {
        if entry.path().is_dir() {
            if let Some(name) = entry.file_name().to_str() {
                if !name.starts_with('.') { out.push(name.to_string()); }
            }
        }
    }
    Ok(out)
}

#[tauri::command]
fn run_plugin(name: String) -> Result<String, String> {
    use std::io::Read;
    use std::time::{Duration, Instant};

    // Reject path traversal — plugin name must be a bare filename inside the plugins dir.
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(format!("invalid plugin name: {}", name));
    }
    let plugin_path = format!("C:\\Xova\\plugins\\{}", name);
    if !std::path::Path::new(&plugin_path).exists() {
        return Err(format!("plugin not found: {}", plugin_path));
    }

    let mut cmd = std::process::Command::new("python");
    cmd.arg(&plugin_path);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    no_window(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| format!("Failed to run plugin: {}", e))?;

    // 30s wall-clock timeout — interactive plugins (matplotlib windows, audio loops)
    // must not deadlock the chat surface. Plugins panel can still launch them visually.
    let deadline = Instant::now() + Duration::from_secs(30);
    let exit_status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!(
                        "plugin '{}' timed out after 30s (likely interactive — open it from the Plugins panel instead)",
                        name
                    ));
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(format!("wait failed: {}", e)),
        }
    };

    let mut stdout_buf = String::new();
    let mut stderr_buf = String::new();
    if let Some(mut s) = child.stdout.take() {
        let _ = s.read_to_string(&mut stdout_buf);
    }
    if let Some(mut s) = child.stderr.take() {
        let _ = s.read_to_string(&mut stderr_buf);
    }

    if !exit_status.success() {
        return Err(format!("plugin error (exit {}): {}",
            exit_status.code().unwrap_or(-1),
            stderr_buf.trim()));
    }
    Ok(if stdout_buf.trim().is_empty() { "Done (no output)".to_string() } else { stdout_buf })
}

#[tauri::command]
async fn xova_vision(image_path: String, prompt: Option<String>) -> Result<String, String> {
    use base64::Engine;
    let img_bytes = std::fs::read(&image_path).map_err(|e| format!("Cannot read image: {}", e))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&img_bytes);
    let question = prompt.unwrap_or_else(|| "Describe exactly what you see on this screen. List all visible windows, text, buttons, applications, and UI elements in detail.".to_string());
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| format!("client build: {}", e))?;

    // Try moondream first (small, fits 4GB GPU). Fall back to gemma4 if not installed.
    for model in &["moondream", "gemma4"] {
        let body = serde_json::json!({
            "model": model,
            "messages": [{"role": "user", "content": question.clone(), "images": [b64.clone()]}],
            "stream": false,
            "keep_alive": "1h",
            "options": {"num_ctx": 2048, "temperature": 0.1}
        });
        let resp = match client.post("http://localhost:11434/api/chat").json(&body).send().await {
            Ok(r) => r,
            Err(_) => continue,
        };
        let json: serde_json::Value = match resp.json().await {
            Ok(j) => j,
            Err(_) => continue,
        };
        if let Some(err) = json.get("error").and_then(|e| e.as_str()) {
            // Model not found / not installed — try the next one
            if err.contains("not found") || err.contains("does not exist") {
                continue;
            }
            return Err(format!("vision error ({}): {}", model, err));
        }
        if let Some(content) = json.get("message").and_then(|m| m.get("content")).and_then(|c| c.as_str()) {
            return Ok(content.to_string());
        }
    }
    Err("no vision model available — install moondream or gemma4".to_string())
}

#[tauri::command]
fn xova_computer(action: String) -> Result<String, String> {
    let mut cmd = std::process::Command::new("python");
    cmd.arg("C:\\Xova\\app\\computer_control.py").arg(&action);
    no_window(&mut cmd);
    let output = cmd.output().map_err(|e| format!("Computer control error: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
fn xova_jarvis(task: String) -> Result<String, String> {
    let mut cmd = std::process::Command::new("python");
    cmd.arg("C:\\Xova\\app\\jarvis.py").arg(&task);
    no_window(&mut cmd);
    let output = cmd.output().map_err(|e| format!("Jarvis error: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
fn xova_field(input: String) -> Result<String, String> {
    let mut cmd = std::process::Command::new("C:\\Xova\\app\\ziltrix.exe");
    cmd.arg(&input);
    no_window(&mut cmd);
    let output = cmd.output().map_err(|e| format!("Ziltrix error: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !stdout.trim().is_empty() {
        Ok(stdout)
    } else if !stderr.trim().is_empty() {
        Err(stderr)
    } else {
        Ok("ziltrix: no output".to_string())
    }
}

#[tauri::command]
fn xova_build_tool(
    target: Option<String>,
    name: String,
    spec: String,
    source: String,
    class_name: Option<String>,
    tool_name: Option<String>,
    allow_subprocess: Option<bool>,
    allow_network: Option<bool>,
) -> Result<String, String> {
    let target_val = target.unwrap_or_else(|| "xova_plugin".to_string());
    let mut payload = serde_json::Map::new();
    payload.insert("target".to_string(), serde_json::Value::from(target_val));
    payload.insert("name".to_string(), serde_json::Value::from(name));
    payload.insert("spec".to_string(), serde_json::Value::from(spec));
    payload.insert("source".to_string(), serde_json::Value::from(source));
    if let Some(v) = class_name {
        payload.insert("class_name".to_string(), serde_json::Value::from(v));
    }
    if let Some(v) = tool_name {
        payload.insert("tool_name".to_string(), serde_json::Value::from(v));
    }
    if let Some(v) = allow_subprocess {
        payload.insert("allow_subprocess".to_string(), serde_json::Value::Bool(v));
    }
    if let Some(v) = allow_network {
        payload.insert("allow_network".to_string(), serde_json::Value::Bool(v));
    }
    let args_json = serde_json::Value::Object(payload).to_string();
    dispatch_mesh("build_tool".to_string(), args_json)
}

/// Fire-and-forget Ollama warmup so the first chat turn doesn't pay the
/// ~37s cold-load tax. Reads the user's selected model from
/// C:\Xova\memory\ollama_settings.json so it preloads the model they actually
/// chose in the Settings panel, not a stale hardcoded default. Runs on a
/// background thread; ignores all errors.
fn warmup_ollama() {
    std::thread::spawn(|| {
        let model = load_chosen_model();
        let body = serde_json::json!({
            "model": model,
            "prompt": "",
            "stream": false,
            "keep_alive": "1h",
        });
        let client = match reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build() {
            Ok(c) => c,
            Err(_) => return,
        };
        let _ = client
            .post("http://localhost:11434/api/generate")
            .json(&body)
            .send();
    });
}

/// Read the user's chosen chat model from ollama_settings.json with fallback
/// to llama3.2:3b. Used by warmup so we preload exactly what the user picked.
fn load_chosen_model() -> String {
    let default = "llama3.2:3b".to_string();
    let path = std::path::Path::new(MEMORY_DIR).join("ollama_settings.json");
    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return default,
    };
    let parsed: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return default,
    };
    parsed.get("model")
        .and_then(|m| m.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or(default)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    warmup_ollama();
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    use tauri_plugin_global_shortcut::ShortcutState;
                    use tauri::Manager;
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    if let Some(w) = app.get_webview_window("main") {
                        // Toggle: if focused, hide. Else show + focus.
                        let visible = w.is_visible().unwrap_or(false);
                        let focused = w.is_focused().unwrap_or(false);
                        if visible && focused {
                            let _ = w.hide();
                        } else {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                    let _ = shortcut; // silence unused if no logging here
                })
                .build()
        )
        .setup(|app| {
            // Register Ctrl+Space as the global hotkey.
            use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, GlobalShortcutExt};
            let ctrl_space = Shortcut::new(Some(Modifiers::CONTROL), Code::Space);
            if let Err(e) = app.global_shortcut().register(ctrl_space) {
                eprintln!("global shortcut register failed: {}", e);
            }
            // System tray — minimize-to-tray + click-to-restore behaviour.
            use tauri::tray::{TrayIconBuilder, MouseButton, MouseButtonState, TrayIconEvent};
            use tauri::menu::{Menu, MenuItem};
            use tauri::Manager;
            let show_item = MenuItem::with_id(app, "show", "Show Xova", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Xova")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;
            // Hide-on-close instead of quit — the app keeps running in tray.
            if let Some(w) = app.get_webview_window("main") {
                let w_clone = w.clone();
                w.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        let _ = w_clone.hide();
                        api.prevent_close();
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            run_command,
            list_dir,
            read_file,
            get_drives,
            index_directory,
            dispatch_mesh,
            cascade_mesh,
            mesh_status,
            save_memory,
            load_memory,
            ollama_chat,
            ollama_chat_stream,
            xova_read_codex,
            xova_read_file,
            xova_list_dir,
            xova_write_file,
            xova_delete_path,
            xova_run,
            xova_ask_jarvis,
            xova_status,
            xova_notify,
            xova_reminders_list,
            xova_reminders_save,
            xova_backup,
            xova_send_to_phone,
            xova_enroll_voice,
            xova_memory_list,
            xova_memory_delete,
            xova_save_upload,
            xova_extract_text,
            xova_export_chat,
            xova_list_phones,
            xova_list_plugins,
            xova_list_repos,
            run_plugin,
            xova_computer,
            xova_vision,
            xova_jarvis,
            xova_field,
            xova_build_tool,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Xova");
}
