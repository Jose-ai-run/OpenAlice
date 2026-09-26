import { describe, expect, it } from 'vitest'
import { checkRiskEngineDeploymentSafety } from './deployment-safety.js'

describe('checkRiskEngineDeploymentSafety', () => {
  it('refuses to start: policy path configured but the engine flag is off', () => {
    const result = checkRiskEngineDeploymentSafety({ OPENALICE_RISK_POLICY_PATH: '/etc/openalice/risk-policy.json' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('OPENALICE_RISK_POLICY_PATH')
    expect(result.error).toContain('OPENALICE_RISK_ENGINE_ENABLED')
  })

  it('refuses to start even if the flag is set to something other than "1" (e.g. "true")', () => {
    const result = checkRiskEngineDeploymentSafety({
      OPENALICE_RISK_POLICY_PATH: '/etc/openalice/risk-policy.json',
      OPENALICE_RISK_ENGINE_ENABLED: 'true',
    })
    expect(result.ok).toBe(false)
  })

  it('starts fine, no warning, when both the policy path and the flag are set correctly', () => {
    const result = checkRiskEngineDeploymentSafety({
      OPENALICE_RISK_POLICY_PATH: '/etc/openalice/risk-policy.json',
      OPENALICE_RISK_ENGINE_ENABLED: '1',
    })
    expect(result.ok).toBe(true)
    expect(result.warn).toBeUndefined()
  })

  it('starts fine but with a visible warning when the flag is off and no policy path is set (intentional local dev)', () => {
    const result = checkRiskEngineDeploymentSafety({})
    expect(result.ok).toBe(true)
    expect(result.warn).toContain('RiskEngine is DISABLED')
  })

  it('starts fine, no warning, when the flag is on even without an explicit policy path (falls back to the default path)', () => {
    const result = checkRiskEngineDeploymentSafety({ OPENALICE_RISK_ENGINE_ENABLED: '1' })
    expect(result.ok).toBe(true)
    expect(result.warn).toBeUndefined()
  })

  it('treats a blank/whitespace-only policy path as not set', () => {
    const result = checkRiskEngineDeploymentSafety({ OPENALICE_RISK_POLICY_PATH: '   ' })
    expect(result.ok).toBe(true)
    expect(result.warn).toContain('RiskEngine is DISABLED')
  })
})
