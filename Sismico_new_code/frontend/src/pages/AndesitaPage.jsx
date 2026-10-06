import React from 'react'
import LegacyStyledSismicoPage from '../components/sismico/LegacyStyledSismicoPage'
import { getSismicoLegacySiteConfig } from '../config/sismicoLegacySiteConfigs'
import './AndesitaPage.css'

export default function AndesitaPage() {
  return <LegacyStyledSismicoPage config={getSismicoLegacySiteConfig('andesita')} />
}
