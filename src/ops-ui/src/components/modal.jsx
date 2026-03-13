import { useState, useRef, useEffect } from "preact/hooks";
import { authModalOpen, overrideModal, confirmModal, token, showToast } from "../state.js";
import { fetchMe } from "../api.js";
import { XIcon } from "./icons.jsx";

// --- Auth Modal ---
export function AuthModal() {
  const open = authModalOpen.value;
  const inputRef = useRef(null);
  const [val, setVal] = useState("");

  useEffect(() => {
    if (open) {
      setVal(token.value);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  const close = () => { authModalOpen.value = false; };
  const save = () => {
    token.value = val;
    fetchMe();
    close();
  };

  return (
    <div class="modal">
      <div class="modal-backdrop" onClick={close} />
      <div class="modal-dialog small">
        <div class="modal-header">
          <h3>Authentication</h3>
          <button class="btn-icon" onClick={close}><XIcon /></button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label data-tooltip="Authenticates your session with the Clasper Core Ops API. Use the key from your control plane or environment (e.g. CLASPER_OPS_API_KEY).">Ops API Key</label>
            <input ref={inputRef} type="password" placeholder="Paste Ops API key..." value={val} onInput={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
          </div>
          <div class="flex gap-2 justify-end">
            <button class="btn-ghost" onClick={close}>Cancel</button>
            <button class="btn-primary" onClick={save}>Sign In</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Override Modal ---
export function OverrideModal() {
  const { open, callback, message } = overrideModal.value;
  const [reason, setReason] = useState("");
  const [just, setJust] = useState("");
  const [err, setErr] = useState("");

  if (!open) return null;

  const close = () => { overrideModal.value = { open: false, callback: null, message: "" }; };
  const submit = () => {
    if (!reason || just.trim().length < 10) {
      setErr("Select a reason and provide justification (10+ chars).");
      return;
    }
    if (callback) callback({ reason_code: reason, justification: just.trim() });
    close();
  };

  return (
    <div class="modal">
      <div class="modal-backdrop" onClick={close} />
      <div class="modal-dialog">
        <div class="modal-header">
          <h3>Override Required</h3>
          <button class="btn-icon" onClick={close}><XIcon /></button>
        </div>
        <div class="modal-body">
          <div class="alert warn">
            <AlertTriIcon />
            <p class="modal-message">{message || "This action requires a structured override with justification."}</p>
          </div>
          <div class="form-group">
            <label>Reason Code</label>
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Select a reason...</option>
              <option value="incident_response">Incident Response</option>
              <option value="hotfix">Hotfix</option>
              <option value="business_deadline">Business Deadline</option>
              <option value="data_correction">Data Correction</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div class="form-group">
            <label>Justification</label>
            <textarea rows={3} placeholder="Explain why this override is necessary (min 10 chars)..." value={just} onInput={(e) => setJust(e.target.value)} />
          </div>
          {err && <div class="error-message">{err}</div>}
        </div>
        <div class="modal-footer">
          <button class="btn-ghost" onClick={close}>Cancel</button>
          <button class="btn-danger" onClick={submit}>Confirm Override</button>
        </div>
      </div>
    </div>
  );
}

function AlertTriIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
}

// --- Confirm Modal ---
export function ConfirmModal() {
  const { open, title, message, callback } = confirmModal.value;
  if (!open) return null;

  const close = () => { confirmModal.value = { open: false, title: "", message: "", callback: null }; };
  const confirm = () => { if (callback) callback(); close(); };

  return (
    <div class="modal">
      <div class="modal-backdrop" onClick={close} />
      <div class="modal-dialog small">
        <div class="modal-header">
          <h3>{title || "Confirm Action"}</h3>
          <button class="btn-icon" onClick={close}><XIcon /></button>
        </div>
        <div class="modal-body">
          <div>{message || "Are you sure?"}</div>
        </div>
        <div class="modal-footer">
          <button class="btn-ghost" onClick={close}>Cancel</button>
          <button class="btn-primary" onClick={confirm}>Confirm</button>
        </div>
      </div>
    </div>
  );
}
