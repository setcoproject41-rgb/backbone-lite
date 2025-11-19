

import { createClient } from '@supabase/supabase-js';

// Inisialisasi Klien Supabase di sisi klien (Next.js)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Fungsi untuk mengambil data laporan
export async function getServerSideProps() {
  const { data: reports, error } = await supabase
    .from('report_logs')
    .select('*, project_structure(designator_name, span_num)') // Join sederhana
    .order('date', { ascending: false })
    .limit(10);

  if (error) {
    console.error(error);
  }

  return {
    props: {
      reports: reports || [],
    },
  };
}


export default function Dashboard({ reports }) {
  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>🛠️ Project Management Dashboard (Laporan Terbaru)</h1>
      <p>Data diambil dari Supabase via Server-Side Rendering.</p>
      
      <h2>Laporan yang Belum Divalidasi ({reports.filter(r => !r.is_validated).length})</h2>
      
      <table border="1" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ backgroundColor: '#f2f2f2' }}>
            <th>Tanggal</th>
            <th>Lokasi (Designator-Span)</th>
            <th>Progress Detail</th>
            <th>Volume</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((report) => (
            <tr key={report.id}>
              <td>{new Date(report.date).toLocaleDateString()}</td>
              <td>{report.project_structure.designator_name}-{report.project_structure.span_num}</td>
              <td>{report.progress_detail}</td>
              <td>{report.volume_reported}</td>
              <td style={{ color: report.is_validated ? 'green' : 'red' }}>
                {report.is_validated ? 'VALIDATED' : 'PENDING'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ marginTop: '20px' }}>*Lanjutkan pengembangan di sini untuk membuat fitur Validasi, Monitoring Material, dan Bagan Gantt.</p>
    </div>
  );
}
