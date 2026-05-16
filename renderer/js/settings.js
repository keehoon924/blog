function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `show ${type}`;
  setTimeout(() => { t.className = ''; }, 3000);
}

function togglePw(id, btn) {
  const input = document.getElementById(id);
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '🙈';
  } else {
    input.type = 'password';
    btn.textContent = '👁';
  }
}

async function loadSettings() {
  const res = await api.getSettings();
  if (!res.success || !res.data) return;
  const d = res.data;

  if (d.naverID) document.getElementById('naverID').value = d.naverID;
  if (d.naverPW) document.getElementById('naverPW').value = d.naverPW;
  if (d.openaiKey) document.getElementById('openaiKey').value = d.openaiKey;
  if (d.datalabClientId) document.getElementById('datalabClientId').value = d.datalabClientId;
  if (d.datalabClientSecret) document.getElementById('datalabClientSecret').value = d.datalabClientSecret;
  if (d.morningTime) document.getElementById('morningTime').value = d.morningTime;
  if (d.lunchTime) document.getElementById('lunchTime').value = d.lunchTime;
  if (d.eveningTime) document.getElementById('eveningTime').value = d.eveningTime;
}

async function handleSave() {
  const settings = {
    naverID: document.getElementById('naverID').value.trim(),
    naverPW: document.getElementById('naverPW').value,
    openaiKey: document.getElementById('openaiKey').value.trim(),
    datalabClientId: document.getElementById('datalabClientId').value.trim(),
    datalabClientSecret: document.getElementById('datalabClientSecret').value.trim(),
    morningTime: document.getElementById('morningTime').value.trim() || '09:00',
    lunchTime: document.getElementById('lunchTime').value.trim() || '12:00',
    eveningTime: document.getElementById('eveningTime').value.trim() || '18:00',
  };

  if (!settings.naverID || !settings.naverPW) {
    showToast('네이버 아이디와 비밀번호를 입력해주세요.', 'error');
    return;
  }

  const res = await api.saveSettings(settings);
  if (res.success) {
    showToast('설정이 저장되었습니다.', 'success');
  } else {
    showToast(res.error || '저장 실패', 'error');
  }
}

loadSettings();
