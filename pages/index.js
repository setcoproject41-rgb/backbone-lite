// pages/index.js

import { createClient } from '@supabase/supabase-js';

// =================================================================
// 1. INISIALISASI SUPABASE KLIEN (PUBLIC KEY)
// =================================================================
// Gunakan Anon Key (NEXT_PUBLIC) untuk frontend read-only
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// =================================================================
// 2. FUNGSI PENGAMBILAN DATA (SSR)
// =================================================================
export async function getServerSideProps() {
  const { data: reports, error } = await supabase
    // Mengambil log laporan dan melakukan join ke project_structure
    .from('report_logs')
    // Menggunakan optional chaining di select untuk mengambil data project_structure jika ada
    .select('*, project_structure(designator_name, span_num)')
    .order('date', { ascending: false })
    .limit(50); // Batasi 50 laporan terbaru

  if (error) {
    console.error('Error fetching reports:', error);
    // Kembalikan array kosong agar rendering aman jika ada kegagalan fetch
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
// 3. KOMPONEN DASHBOARD
// =================================================================
export default function Dashboard({ reports, fetchError }) {
    
    // Asumsi: Admin login adalah "Supervisor_A" (Ini harusnya diatur melalui sistem otentikasi)
    const ADMIN_NAME = "Supervisor_A";

    if (fetchError) {
        return <div style={{ color: 'red', padding: '20px' }}>Error loading data: {fetchError}</div>;
    }
    
    /**
     * Fungsi untuk mengirim permintaan POST ke API Validasi
     */
    const handleValidation = async (reportId) => {
        if (!confirm(`Yakin memvalidasi laporan ini (${reportId})? Volume RAB akan diupdate.`)) {
            return;
        }

        try {
            const response = await fetch('/api/validate-report', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    report_id: reportId,
                    admin_name: ADMIN_NAME 
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                alert(`Gagal Validasi: ${errorData.message}`);
                return;
            }

            alert('Validasi Berhasil! Halaman akan di-refresh.');
            // Refresh halaman setelah sukses validasi
            window.location.reload(); 

        } catch (error) {
            console.error('Client validation error:', error);
            alert('Terjadi kesalahan koneksi.');
        }
    };
        
    return (
        <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
            <h1>🛠️ Project Management Dashboard</h1>
            <p>Menampilkan {reports.length} laporan terbaru. Data diambil dari Supabase. (Admin: {ADMIN_NAME})</p>
            
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
                        <th>Aksi</th>
                    </tr>
                </thead>
                <tbody>
                    {reports.map((report) => (
                        <tr key={report.id}>
                            <td>{new Date(report.date).toLocaleDateString()}</td>
                            <td>{report.reporter_id}</td>
                            
                            {/* PENGAMANAN: Menggunakan Optional Chaining (?.) untuk mencegah error rendering */}
                            <td>
                                {report.project_structure?.designator_name 
                                    ? `${report.project_structure.designator_name}-${report.project_structure.span_num}` 
                                    : 'Lokasi Tidak Dikenal'
                                }
                            </td>
                            
                            <td>{report.progress_detail}</td>
                            <td>{report.volume_reported || '0'}</td>
                            <td style={{ color: report.is_validated ? 'green' : 'red', fontWeight: 'bold' }}>
                                {report.is_validated ? 'VALIDATED' : 'PENDING'}
                            </td>
                            
                            {/* KOLOM AKSI */}
                            <td>
                                {!report.is_validated ? (
                                    <button 
                                        onClick={() => handleValidation(report.id)}
                                        style={{ backgroundColor: 'green', color: 'white', border: 'none', padding: '5px 10px', cursor: 'pointer' }}
                                    >
                                        Validasi & Update RAB
                                    </button>
                                ) : (
                                    `Oleh ${report.validated_by || 'Admin'}`
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <p style={{ marginTop: '20px', fontStyle: 'italic', color: '#666' }}>*Laporan yang sudah divalidasi akan menambah total volume di tabel RAB.</p>
        </div>
    );
}
