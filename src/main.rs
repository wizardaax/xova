use eframe::egui;
use egui::{Color32, FontId, RichText, ScrollArea, TextEdit, Vec2};
use std::fs;
use std::io::{Read, Write as IoWrite};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const NO_WINDOW: u32 = 0x08000000;

const PLUGINS: &str = r"D:\Aeon\plugins";
const OLLAMA:  &str = "127.0.0.1:11434";
const MODEL:   &str = "llama3";

// Write text to Windows clipboard via clip.exe stdin — works with any content
fn to_clipboard(s: &str) {
    if let Ok(mut child) = Command::new("clip")
        .creation_flags(NO_WINDOW)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(s.as_bytes());
        }
        let _ = child.wait();
    }
}

fn main() -> eframe::Result<()> {
    eframe::run_native(
        "Aeon",
        eframe::NativeOptions {
            viewport: egui::ViewportBuilder::default()
                .with_inner_size([960.0, 700.0])
                .with_min_inner_size([400.0, 300.0]),
            renderer: eframe::Renderer::Glow,
            ..Default::default()
        },
        Box::new(|_cc| Ok(Box::new(App::new()))),
    )
}

#[derive(Clone, PartialEq)]
enum Who { Me, Aeon, Info }

struct Msg { who: Who, text: String }

struct App {
    input:     String,
    msgs:      Vec<Msg>,
    pending:   Arc<Mutex<Vec<Msg>>>,
    inp_id:    egui::Id,
    chat_text: String,
    focused:   bool,
}

impl App {
    fn new() -> Self {
        let mut a = Self {
            input:     String::new(),
            msgs:      Vec::new(),
            pending:   Arc::new(Mutex::new(Vec::new())),
            inp_id:    egui::Id::new("inp"),
            chat_text: String::new(),
            focused:   false,
        };
        let plugins = ls_plugins();
        a.push_info(format!(
            "Aeon ready · {} plugin(s) in {} · model: {}\nCommands: list | speak <text> | search <q> | run <plugin> | or just chat",
            plugins.len(), PLUGINS, MODEL
        ));
        a
    }

    fn push_info(&mut self, s: impl Into<String>) {
        self.msgs.push(Msg { who: Who::Info, text: s.into() });
        self.rebuild();
    }

    fn push_aeon(&mut self, s: impl Into<String>) {
        self.msgs.push(Msg { who: Who::Aeon, text: s.into() });
        self.rebuild();
    }

    fn rebuild(&mut self) {
        self.chat_text = self.msgs.iter().map(|m| match m.who {
            Who::Me   => format!("[You]  {}\n\n", m.text),
            Who::Aeon => format!("[Aeon] {}\n\n", m.text),
            Who::Info => format!("       {}\n\n", m.text),
        }).collect();
    }

    fn drain(&mut self) {
        let batch: Vec<Msg> = self.pending.lock().unwrap().drain(..).collect();
        if !batch.is_empty() {
            for m in batch { self.msgs.push(m); }
            self.rebuild();
        }
    }

    fn send(&mut self) {
        let raw = self.input.trim().to_string();
        if raw.is_empty() { return; }
        self.input.clear();
        self.msgs.push(Msg { who: Who::Me, text: raw.clone() });
        self.rebuild();

        let lo = raw.to_lowercase();
        let q  = Arc::clone(&self.pending);

        if lo.starts_with("speak ") {
            let t = raw[6..].to_string();
            thread::spawn(move || tts(&t));
            self.push_info("Speaking…");
            return;
        }
        if lo == "list" || lo == "plugins" {
            let list = ls_plugins();
            self.push_aeon(if list.is_empty() {
                format!("No plugins found in {}", PLUGINS)
            } else {
                format!("Plugins:\n{}", list.join("\n"))
            });
            return;
        }
        if lo.starts_with("search ") {
            let url = format!("https://www.google.com/search?q={}", raw[7..].replace(' ', "+"));
            nocmd(&format!("start {}", url));
            self.push_info("Opened browser.");
            return;
        }
        if lo.starts_with("run ") || lo.starts_with("plugin ") {
            let name = raw.splitn(2, ' ').nth(1).unwrap_or("").trim().to_string();
            match find_plugin(&name) {
                Some(p) => {
                    self.push_info(format!("Running {}…", name));
                    thread::spawn(move || {
                        q.lock().unwrap().push(Msg { who: Who::Aeon, text: exec_plugin(&p) });
                    });
                }
                None => self.push_info(format!("Plugin '{}' not found.", name)),
            }
            return;
        }

        // Ollama
        self.push_info("Thinking…");
        thread::spawn(move || {
            let reply = ollama(&raw);
            let r2 = reply.clone();
            q.lock().unwrap().push(Msg { who: Who::Aeon, text: reply });
            thread::spawn(move || tts(&r2));
        });
    }
}

impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _: &mut eframe::Frame) {
        self.drain();
        ctx.request_repaint_after(std::time::Duration::from_millis(80));
        ctx.set_visuals(egui::Visuals::dark());

        // Ctrl+C → copy full chat via clip.exe (bypasses egui clipboard)
        if ctx.input(|i| i.modifiers.ctrl && i.key_pressed(egui::Key::C)) {
            to_clipboard(&self.chat_text);
        }
        // Enter sends message
        if ctx.input(|i| i.key_pressed(egui::Key::Enter)) {
            self.send();
            ctx.memory_mut(|m| m.request_focus(self.inp_id));
        }

        egui::CentralPanel::default().show(ctx, |ui| {
            // ── Header ──────────────────────────────────────────────
            ui.horizontal(|ui| {
                ui.label(
                    RichText::new("⬡  AEON")
                        .font(FontId::proportional(22.0))
                        .color(Color32::from_rgb(80, 180, 255)),
                );
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if ui.button("Copy All").clicked() {
                        to_clipboard(&self.chat_text.clone());
                    }
                });
            });
            ui.separator();

            // ── Chat area ───────────────────────────────────────────
            let remaining = ui.available_height() - 44.0;
            ScrollArea::vertical()
                .id_source("chat_scroll")
                .max_height(remaining)
                .stick_to_bottom(true)
                .drag_to_scroll(false)   // let TextEdit handle drags for selection
                .show(ui, |ui| {
                    let te = ui.add(
                        TextEdit::multiline(&mut self.chat_text)
                            .id(egui::Id::new("chat_body"))
                            .font(FontId::monospace(13.0))
                            .desired_width(f32::INFINITY)
                            .desired_rows(20)
                            .frame(false)
                            .text_color(Color32::from_rgb(200, 215, 230)),
                    );
                    // If user edits chat area, restore it next drain (it's read-only in spirit)
                    let _ = te;
                });

            ui.separator();

            // ── Input bar ───────────────────────────────────────────
            ui.add_space(2.0);
            ui.horizontal(|ui| {
                let r = ui.add(
                    TextEdit::singleline(&mut self.input)
                        .id(self.inp_id)
                        .desired_width(ui.available_width() - 72.0)
                        .hint_text("type a message and press Enter…")
                        .font(FontId::monospace(14.0)),
                );
                if !self.focused {
                    ctx.memory_mut(|m| m.request_focus(self.inp_id));
                    self.focused = true;
                }
                if ui.button(
                    RichText::new("Send").color(Color32::from_rgb(80, 180, 255))
                ).clicked() {
                    self.send();
                    ctx.memory_mut(|m| m.request_focus(self.inp_id));
                }
                let _ = r;
            });
            ui.add_space(4.0);
        });
    }
}

// ── TTS via PowerShell SAPI ──────────────────────────────────────────────────
fn tts(text: &str) {
    let s: String = text.chars().take(300).collect();
    let safe = s.replace('\'', "''");
    let cmd = format!(
        "Add-Type -AssemblyName System.Speech; \
         $x = New-Object System.Speech.Synthesis.SpeechSynthesizer; \
         $x.Speak('{}')",
        safe
    );
    let _ = Command::new("powershell")
        .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &cmd])
        .creation_flags(NO_WINDOW)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

// ── Shell command (no window) ────────────────────────────────────────────────
fn nocmd(cmd: &str) {
    let _ = Command::new("cmd")
        .args(["/c", cmd])
        .creation_flags(NO_WINDOW)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

// ── Ollama via raw TCP ───────────────────────────────────────────────────────
fn ollama(prompt: &str) -> String {
    let body = format!(
        "{{\"model\":\"{}\",\"prompt\":{},\"stream\":false}}",
        MODEL,
        serde_json::to_string(prompt).unwrap_or_default()
    );
    let req = format!(
        "POST /api/generate HTTP/1.0\r\nHost: localhost\r\n\
         Content-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
        body.len(), body
    );
    let Ok(mut s) = TcpStream::connect(OLLAMA) else {
        return "Ollama offline — run: ollama serve".into();
    };
    s.set_read_timeout(Some(std::time::Duration::from_secs(120))).ok();
    if s.write_all(req.as_bytes()).is_err() { return "Write error".into(); }
    let mut resp = String::new();
    if s.read_to_string(&mut resp).is_err() { return "Read error".into(); }
    let json = resp.splitn(2, "\r\n\r\n").nth(1).unwrap_or(&resp);
    let v: serde_json::Value = serde_json::from_str(json).unwrap_or_default();
    v["response"].as_str().unwrap_or("(empty)").trim().to_string()
}

// ── Plugin helpers ───────────────────────────────────────────────────────────
fn ls_plugins() -> Vec<String> {
    let Ok(rd) = fs::read_dir(PLUGINS) else { return Vec::new(); };
    let mut v: Vec<String> = rd
        .filter_map(Result::ok)
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    v.sort();
    v
}

fn find_plugin(name: &str) -> Option<PathBuf> {
    let base = Path::new(PLUGINS);
    for ext in ["", ".py", ".sh", ".exe", ".bin"] {
        let p = base.join(format!("{}{}", name, ext));
        if p.exists() { return Some(p); }
    }
    None
}

fn exec_plugin(path: &Path) -> String {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let mut cmd: Command = match ext {
        "py" => { let mut c = Command::new("python"); c.arg(path); c }
        "sh" => { let mut c = Command::new("wsl"); c.arg(path); c }
        _    => Command::new(path),
    };
    cmd.stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(NO_WINDOW);
    match cmd.output() {
        Ok(o) => {
            let out = String::from_utf8_lossy(&o.stdout).to_string();
            let err = String::from_utf8_lossy(&o.stderr).to_string();
            let r = if !out.trim().is_empty() { out } else { err };
            if r.trim().is_empty() { "Done.".into() } else { r.trim().chars().take(3000).collect() }
        }
        Err(e) => format!("Error: {}", e),
    }
}
