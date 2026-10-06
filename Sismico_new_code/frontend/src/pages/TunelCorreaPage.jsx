import React from 'react'
import LegacyStyledSismicoPage from '../components/sismico/LegacyStyledSismicoPage'
import { getSismicoLegacySiteConfig } from '../config/sismicoLegacySiteConfigs'
import './TunelCorreaPage.css'

export default function TunelCorreaPage() {
  return <LegacyStyledSismicoPage config={getSismicoLegacySiteConfig('andes_norte_tunel_correa')} />
}
