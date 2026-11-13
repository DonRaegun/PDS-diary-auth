try { const t = localStorage.getItem('pds-theme'); if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t; } catch { /* 저장된 선택이 없으면 기기 설정을 따름 */ }
