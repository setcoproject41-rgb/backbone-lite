<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Dashboard RMJ Backbone</title>
  <style>
    body {
      font-family: system-ui, Arial;
      background: #f8fafc;
      max-width: 1000px;
      margin: 20px auto;
      padding: 16px;
    }
    h1 {
      text-align: center;
      margin-bottom: 16px;
    }
    .card {
      background: #fff;
      border-radius: 10px;
      border: 1px solid #e2e8f0;
      padding: 16px;
      margin-bottom: 16px;
      box-shadow: 0 1px 6px rgba(0,0,0,0.06);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
      font-size: 13px;
    }
    th, td {
      border: 1px solid #e5e7eb;
      padding: 6px;
      text-align: left;
    }
    th {
      background: #f1f5f9;
    }
    img.thumb {
      height: 60px;
      border-radius: 6px;
    }
    button {
      background: #3b82f6;
      color: white;
      border: none;
      padding: 8px 14px;
      border-radius: 6px;
      cursor: pointer;
    }
    button:hover { background: #2563eb; }
  </style>
</head>
<body>
  <h1>📊 RMJ Backbone — Dashboard Laporan</h1>

  <div class="card" style="background:#ebf8ff">
    <h3>📈 Ringkasan Proyek</h3>
    <p id="totalProgress">Total Progress: -</p>
    <p id="percentProgress">Pencapaian: -</p>
    <canvas id="chart" height="120"></canvas>
  </div>

  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <h3>🗂️ Daftar Laporan</h3>
      <button onclick="downloadCSV()">⬇️ Download CSV</button>
    </div>
    <div id="loadStatus"></div>
    <table>
      <thead>
        <tr>
          <th>Tanggal</th>
          <th>Nama Pekerjaan</th>
          <th>Volume</th>
          <th>Material</th>
          <th>Keterangan</th>
          <th>Progress</th>
          <th>Lokasi</th>
          <th>Eviden Sebelum</th>
          <th>Eviden Sesudah</th>
        </tr>
      </thead>
      <tbody id="tbody"></tbody>
    </table>
  </div>

  <!-- ✅ Supabase + Chart.js -->
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>

  <script>
    const SUPABASE_URL = 'https://zpcuzrifbisrcjtqgqyv.supabase.co'
    const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpwY3V6cmlmYmlzcmNqdHFncXl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5MTYyMTcsImV4cCI6MjA3NzQ5MjIxN30.BQnuSVPu7rfKyPwZpZUwD5e4bUepFrrKHPzZhpq8OCg'
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON)

    const tbody = document.getElementById('tbody')
    const loadStatus = document.getElementById('loadStatus')
    let chart

    async function loadReports() {
      loadStatus.textContent = 'Memuat data...'
      const { data, error } = await supabase
        .from('reports')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error ambil data:', error)
        loadStatus.textContent = 'Gagal memuat data: ' + error.message
        return
      }

      if (!data || data.length === 0) {
        loadStatus.textContent = 'Belum ada laporan.'
        tbody.innerHTML = ''
        return
      }

      loadStatus.textContent = `Menampilkan ${data.length} laporan`
      tbody.innerHTML = ''
      data.forEach(r => {
        const tr = document.createElement('tr')
        const d = new Date(r.created_at).toLocaleString()
        const loc = (r.latitude && r.longitude)
          ? `${r.latitude.toFixed(6)}, ${r.longitude.toFixed(6)}`
          : '-'
        tr.innerHTML = `
          <td>${d}</td>
          <td>${r.nama_pekerjaan || '-'}</td>
          <td>${r.volume_pekerjaan || '-'}</td>
          <td>${r.material || '-'}</td>
          <td>${r.keterangan || '-'}</td>
          <td>${r.progress || '-'}</td>
          <td>${loc}</td>
          <td>${r.photo_before ? `<a href="${r.photo_before}" target="_blank"><img src="${r.photo_before}" class="thumb" /></a>` : '-'}</td>
          <td>${r.photo_after ? `<a href="${r.photo_after}" target="_blank"><img src="${r.photo_after}" class="thumb" /></a>` : '-'}</td>
        `
        tbody.appendChild(tr)
      })
    }

    async function loadDashboard() {
      const { data, error } = await supabase
        .from('reports')
        .select('progress, telegram_user')

      if (error) return console.error('Error dashboard:', error)
      if (!data?.length) return

      const parsed = data.map(r => {
        const match = r.progress?.match(/([\d.,]+)\s*m/i)
        return { user: r.telegram_user || 'Tanpa Nama', value: match ? parseFloat(match[1].replace(',', '.')) : 0 }
      })

      const teamProgress = {}
      parsed.forEach(p => teamProgress[p.user] = (teamProgress[p.user] || 0) + p.value)

      const total = Object.values(teamProgress).reduce((a,b)=>a+b,0)
      const target = 27000
      const percent = ((total/target)*100).toFixed(1)

      document.getElementById('totalProgress').innerText = `Total Progress: ${total.toLocaleString()} m`
      document.getElementById('percentProgress').innerText = `Pencapaian: ${percent}% dari target 27.000 m`

      const ctx = document.getElementById('chart')
      const labels = Object.keys(teamProgress)
      const values = Object.values(teamProgress)
      if (chart) chart.destroy()
      chart = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ label:'Progress (m)', data: values, backgroundColor:'#3b82f6' }] },
        options: { plugins:{legend:{display:false}} }
      })
    }

    function downloadCSV() {
      const rows = [['Tanggal','Nama Pekerjaan','Volume','Material','Keterangan','Progress','Latitude','Longitude','Eviden Sebelum','Eviden Sesudah']]
      const trs = tbody.querySelectorAll('tr')
      trs.forEach(tr => {
        const tds = [...tr.querySelectorAll('td')].map(td=>td.innerText)
        rows.push(tds)
      })
      const csv = rows.map(e => e.join(',')).join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'laporan_rmj.csv'
      a.click()
      URL.revokeObjectURL(url)
    }

    loadReports()
    loadDashboard()
    setInterval(() => { loadReports(); loadDashboard() }, 30000)
  </script>
</body>
</html>
