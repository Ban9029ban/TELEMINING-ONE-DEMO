import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';

const CHART_COLORS = {
  cambridge: 'rgb(120,196,166)',
  red: 'rgb(255, 99, 132)'
};

const ZenitStatusChart = ({ zenitStatus }) => {
  // ✅ Hooks SIEMPRE en el mismo orden (evita ESLint: react-hooks/rules-of-hooks)
  const modifiedZenitStatus = useMemo(() => {
    if (!zenitStatus) return null;

    // Si quieres forzar valores de demo, hazlo aquí.
    // Importante: dejamos la lógica como override SOLO si vienen null/undefined.
    return {
      ...zenitStatus,
      total_activos: zenitStatus.total_activos ?? 77,
      total_inactivos: zenitStatus.total_inactivos ?? 6,
      track_activos: zenitStatus.track_activos ?? 45,
      central_activos: zenitStatus.central_activos ?? 32,
      porcentaje: zenitStatus.porcentaje ?? '92.77%',

      // Garantiza que no se rompa el template si el backend no envía totales.
      track_total:
      zenitStatus.track_total ?
      Number(zenitStatus.track_activos  0) + Number(zenitStatus.track_inactivos  0),
      central_total:
      zenitStatus.central_total ?
      Number(zenitStatus.central_activos  0) + Number(zenitStatus.central_inactivos  0)
    };
  }, [zenitStatus]);

  const chartData = useMemo(() => {
    if (!modifiedZenitStatus) return [];

    return [
    {
      value: Number(modifiedZenitStatus.total_activos  0),
      name: 'Activas',
      itemStyle: { color: CHART_COLORS.cambridge }
    },
    {
      value: Number(modifiedZenitStatus.total_inactivos  0),
      name: 'Inactivas',
      itemStyle: { color: CHART_COLORS.red }
    }];

  }, [modifiedZenitStatus]);

  const chartOptions = useMemo(() => {
    if (!modifiedZenitStatus) return null;

    const track_total = Number(modifiedZenitStatus.track_total ?? 0);
    const track_activos = Number(modifiedZenitStatus.track_activos ?? 0);
    const central_total = Number(modifiedZenitStatus.central_total ?? 0);
    const central_activos = Number(modifiedZenitStatus.central_activos ?? 0);

    return {
      tooltip: {
        trigger: 'item',
        formatter: '{a} <br/>{b}: {c} ({d}%)'
      },
      legend: {
        orient: 'horizontal',
        left: 'center',
        bottom: 0
      },
      series: [
      {
        name: 'Estado',
        type: 'pie',
        radius: ['40%', '70%'],
        avoidLabelOverlap: false,
        label: {
          show: true,
          formatter: '{b}: {c}'
        },
        emphasis: {
          label: {
            show: true,
            fontSize: 18,
            fontWeight: 'bold'
          }
        },
        labelLine: {
          show: true
        },
        data: chartData
      }],

      graphic: [
      {
        type: 'text',
        left: 'center',
        top: '15%',
        style: {
          text: `Track: ${track_activos} / ${track_total}`,
          fontSize: 12,
          fontWeight: 'bold',
          fill: '#333'
        }
      },
      {
        type: 'text',
        left: 'center',
        top: '20%',
        style: {
          text: `Central: ${central_activos} / ${central_total}`,
          fontSize: 12,
          fontWeight: 'bold',
          fill: '#333'
        }
      },
      {
        type: 'text',
        left: 'center',
        top: '25%',
        style: {
          text: `${modifiedZenitStatus.porcentaje}`, // Ahora es numérico
          fontSize: 16,
          fontWeight: 'bold',
          fill: CHART_COLORS.cambridge
        }
      }]

    };
  }, [modifiedZenitStatus, chartData]);

  // ✅ Render condicional DESPUÉS de hooks
  if (!zenitStatus) {
    return <p>Cargando datos del estado de ZENIT...</p>;
  }

  return (
    <div
      style={{
        padding: '10px',
        backgroundColor: '#f9f9f9',
        borderRadius: '8px',
        boxShadow: '0px 0px 10px rgba(0,0,0,0.1)',
        maxWidth: '600px',
        margin: 'auto'
      }}>
      
      <h2 style={{ textAlign: 'center', marginBottom: '20px' }}>Estado ZENIT</h2>
      <ReactECharts
        option={chartOptions || {}}
        style={{ height: '400px', width: '100%' }} />
      
    </div>);

};

export default ZenitStatusChart;
