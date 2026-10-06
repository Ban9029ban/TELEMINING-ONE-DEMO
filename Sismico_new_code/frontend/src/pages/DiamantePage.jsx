import React from 'react'
import LegacyStyledSismicoPage from '../components/sismico/LegacyStyledSismicoPage'
import { getSismicoLegacySiteConfig } from '../config/sismicoLegacySiteConfigs'
import './DiamantePage.css'

export default function DiamantePage() {
  return <LegacyStyledSismicoPage config={getSismicoLegacySiteConfig('diamante')} />
}
