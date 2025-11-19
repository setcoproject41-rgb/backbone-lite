// pages/index.js (Formulir Web Laporan & Dashboard)

import { createClient } from '@supabase/supabase-js';
import { useState, useEffect } from 'react';

// =================================================================
// 1. INISIALISASI SUPABASE KLIEN
// =================================================================
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Helper function untuk fetch data di sisi klien
const fetchProjectData = async () => {
  const { data: structures, error: structError } = await supabase
    .from('project_structure')
    .select('id, designator_name, span_num')
    .order('span_num', { ascending: true });

  if (structError) {
    console.error('Error fetching project structures:', structError);
    return [];
  }
  return structures;
};

// =================================================================
// 2. KOMPONEN WEB FORM
// =================================================================
function ReportForm({ projectStructures }) {
  const [formData, setFormData] = useState({
    structure_id: '',
    reporter_id: 'WEB_USER_001', // ID sementara
    progress_detail: '',
    volume_reported: '',
    files: [],
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e) => {
    setFormData((prev) => ({ ...prev, files: Array.from(e.target.files) }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.structure_id || !formData.progress_detail || formData.files.length === 0) {
      setMessage('Semua field Lokasi, Keterangan, dan minimal 1 file harus diisi.');
      return;
    }

    setIsSubmitting(true);
    setMessage('⏳ Mengirim laporan dan mengunggah file...');

    const data = new FormData();
    for (const key in formData) {
      if (key !== 'files') {
        data.append(key, formData[key]);
      }
    }
    formData.files.forEach((file) => {
      data.append('files', file);
    });
    
    // Kirim data ke API baru
    try {
      const response = await fetch('/api/submit-report', {
        method: 'POST',
        body: data, // Menggunakan FormData
      });

      const result = await response.json();

      if (response.ok) {
        setMessage('✅ Laporan sukses terkirim dan Admin telah dinotifikasi!');
        setFormData({
            structure_id: '',
            reporter_id: 'WEB_USER_001',
            progress_detail: '',
            volume_reported: '',
            files: [],
        });
        // Reload page untuk update dashboard
        setTimeout(() => window.location.reload(), 2000); 
      } else {
        setMessage(`❌ Gagal mengirim laporan: ${result.message}`);
      }
    } catch (error) {
      setMessage('❌ Terjadi kesalahan koneksi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Mengelompokkan struktur berdasarkan Span Number
  const groupedStructures = projectStructures.reduce((acc, curr) => {
    const key = `${curr.designator_name} | ${curr.span_num}`;
    if (!acc[key]) acc[key] = curr;
    return acc;
  }, {});

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '20px', border: '1px solid #ccc', borderRadius: '8px' }}>
      <h2>📝 Formulir Pelaporan Progress</h2>
      <p style={{ color: 'blue', fontWeight: 'bold' }}>*Bot Telegram kini hanya berfungsi sebagai notifikasi.</p>
      
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '15px' }}>
          <label>Lokasi (Designator | Span):</label>
          <select 
            name="structure_id" 
            value={formData.structure_id} 
            onChange={handleChange} 
            required
            style={{ width: '100%', padding: '8px' }}
          >
            <option value="">Pilih Lokasi...</option>
            {Object.keys(groupedStructures).map(key => (
                <option key={groupedStructures[key].id} value={groupedStructures[key].id}>
                    {key}
                </option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label>Keterangan Progress (Job Desc, Detail Pekerjaan):</label>
          <textarea 
            name="progress_detail" 
            value={formData.progress_detail} 
            onChange={handleChange} 
            required
            rows="4"
            style={{ width: '100%', padding: '8px' }}
          />
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label>Volume Selesai (Angka saja, misal: 25.886):</label>
          <input 
            type="number" 
            name="volume_reported" 
            value={formData.volume_reported} 
            onChange={handleChange} 
            required
            step="0.001"
            style={{ width: '100%', padding: '8px' }}
          />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label>Bukti Foto/Video (Upload semua file sekaligus):</label>
          <input 
            type="file" 
            name="files" 
            onChange={handleFileChange} 
            multiple 
            required
            style={{ width: '100%', padding: '8px' }}
          />
        </div>

        <button 
          type="submit" 
          disabled={isSubmitting}
          style={{ padding: '10px 15px', backgroundColor: isSubmitting ? '#aaa' : 'darkblue', color: 'white', border: 'none', borderRadius: '5px', cursor: isSubmitting ? 'not-allowed' : 'pointer' }}
        >
          {isSubmitting ? 'Mengirim...' : 'Kirim Laporan'}
        </button>
        
        {message && <p style={{ marginTop: '10px', color: message.startsWith('❌') ? 'red' : 'green' }}>{message}</p>}
      </form>
    </div>
  );
}

// =================================================================
// 3. KOMPONEN DASHBOARD UTAMA (Menggabungkan Form dan Tabel)
// =================================================================
export default function Dashboard({ reports, fetchError, projectStructures }) {
    
    if (fetchError) {
        return <div style={{ color: 'red', padding: '20px' }}>Error loading data: {fetchError}</div>;
    }
    
    const handleValidation = async (reportId) => {
        // Logika Validasi disederhanakan
        if (!confirm(`Yakin memvalidasi laporan ini (${reportId})?`)) return;

        try {
            const response = await fetch('/api/validate-report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ report_id: reportId, admin_name: "WEB_ADMIN" }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                alert(`Gagal Validasi: ${errorData.message}`);
                return;
            }

            alert('Validasi Berhasil! Halaman akan di-refresh.');
            window.location.reload(); 

        } catch (error) {
            alert('Terjadi kesalahan koneksi.');
        }
    };
        
    return (
        <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
            <h1>🛠️ Project Management System</h1>
            
            <ReportForm projectStructures={projectStructures} />
            
            <hr style={{ margin: '40px 0' }} />

            <h2>Laporan Menunggu Validasi ({reports.filter(r => !r.is_validated).length})</h2>
            
            {/* ... (Table Dashboard Logika SAMA) ... */}
            <table border="1" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                {/* ... (Header Tabel SAMA) ... */}
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
                            
                            <td>
                                {!report.is_validated ? (
                                    <button 
                                        onClick={() => handleValidation(report.id)}
                                        style={{ backgroundColor: 'green', color: 'white', border: 'none', padding: '5px 10px', cursor: 'pointer' }}
                                    >
                                        Validasi
                                    </button>
                                ) : (
                                    `Oleh ${report.validated_by || 'Admin'}`
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// =================================================================
// 4. SERVER SIDE PROPS (SSR)
// =================================================================
export async function getServerSideProps() {
  // Ambil Data Laporan
  const { data: reports, error } = await supabase
    .from('report_logs')
    .select('*, project_structure(designator_name, span_num)')
    .order('date', { ascending: false })
    .limit(50); 
    
  // Ambil Data Struktur untuk Dropdown Form
  const projectStructures = await fetchProjectData();

  if (error) {
    console.error('Error fetching reports:', error);
    return { props: { reports: [], fetchError: error.message, projectStructures: [] } };
  }

  return {
    props: {
      reports: reports,
      fetchError: null,
      projectStructures: projectStructures // Kirim data struktur ke komponen
    },
  };
}
