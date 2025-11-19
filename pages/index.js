// pages/index.js

import { createClient } from '@supabase/supabase-js';

// =================================================================
// INISIALISASI SUPABASE KLIEN (PUBLIC KEY)
// =================================================================
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// =================================================================
// FUNGSI PENGAMBILAN DATA (SSR)
// =================================================================
export async function getServerSideProps() {
  const { data: reports, error } = await supabase
    // Mengambil log laporan dan melakukan join ke project_structure
    .from('report_logs')
    .select('*, project_structure(designator_name, span_num)')
    .order('date', { ascending: false })
    .limit(50); // Batasi 50 laporan terbaru

  if (error) {
    console.error('Error fetching reports:', error);
    // Penting: Jika gagal fetch, kembalikan array kosong agar render aman
    return { props: { reports: [], fetchError: error.message } };
  }

  return {
    props: {
      reports: reports,
      fetchError: null
    },
  };
}


// =================================================================
// KOMPONEN DASHBOARD
// =================================================================
export default function Dashboard({ reports, fetchError }) {
  if (fetchError) {
    return <div style={{ color: 'red', padding: '20px' }}>Error loading data: {fetchError}</div>;
  }
    
  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>🛠️ Project Management Dashboard</h1>
      <p>Menampilkan {reports.length} laporan terbaru. Data diambil dari Supabase.</p>
      
      <h2>Laporan Menunggu Validasi ({reports.filter(r => !r.is_validated).length})</h2>
      
      <table border="1" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
        <thead>
          <tr style={{ backgroundColor: '#f2f2f2' }}>
            <th>Tanggal</th>
            <th>Pelapor</th>
            <th>Lokasi (Designator-Span)</th>
            <th>Progress Detail</th>
            <th>Volume Lapor</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((report) => (
            <tr key={report.id}>
              <td>{new Date(report.date).toLocaleDateString()}</td>
              <td>{report.reporter_id}</td>
              
              {/* PERBAIKAN: Menggunakan Optional Chaining (?.) untuk mencegah error rendering jika join data kosong */}
              <td>
                {report.project_structure?.designator_name 
                  ? `${report.project_structure.designator_name}-${report.project_structure.span_num}` 
                  : 'Lokasi Dihapus'
                }
              </td>
              
              <td>{report.progress_detail}</td>
              <td>{report.volume_reported || '0'}</td>
              <td style={{ color: report.is_validated ? 'green' : 'red', fontWeight: 'bold' }}>
                {report.is_validated ? 'VALIDATED' : 'PENDING'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ marginTop: '20px', fontStyle: 'italic', color: '#666' }}>*Lanjutkan pengembangan di sini untuk membuat fitur Validasi (Tombol Update), Monitoring Material, dan Peta Lokasi.</p>
    </div>
  );
}
