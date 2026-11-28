import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { Auth } from '../../../../core/auth/auth';
import { PreMissionAssessment } from '../../../../models/pre-mission.models';
import { NotificationsRealtime } from '../../../notifications/data-access/notifications-realtime';
import { PreMissionApi } from '../../data-access/pre-mission-api';
import { AssessmentWorkspace } from './assessment-workspace';

const ID = '11111111-1111-4111-8111-111111111111';

function makeAssessment(overrides: Partial<PreMissionAssessment> = {}): PreMissionAssessment {
  return {
    id: ID,
    assessmentCode: 'PMA-SYN-01',
    managerId: 'mgr-1',
    regionId: 'r1',
    regionName: 'Khu vực thử nghiệm',
    plannedStart: '2026-11-28T01:00:00Z',
    plannedEnd: '2026-11-28T05:00:00Z',
    status: 'NotReady',
    overallTechnicalHealth: 'Critical',
    siteFeasibilityStatus: 'Passed',
    validUntil: '2026-12-05T01:00:00Z',
    version: 1,
    findings: JSON.stringify({ inspectorCount: 2, analystCount: 1, technicianCount: 1 }),
    inspectorCount: 2,
    analystCount: 1,
    technicianCount: 1,
    completedMissionId: null,
    towers: [],
    personnelCandidates: [],
    uavCandidates: [
      {
        id: 'd-ready',
        candidateId: 'c1',
        code: 'SYN-UAV-01',
        model: 'SYN-M350',
        isEligible: true,
        operationalStatus: 'Available',
        technicalHealth: 'Healthy',
        readiness: 'Ready',
        batteryLevel: 95,
        isAvailable: true,
        technicalEligibility: 'ELIGIBLE',
      },
      {
        id: 'd-maint',
        candidateId: 'c2',
        code: 'SYN-UAV-02',
        model: 'SYN-M300',
        isEligible: false,
        operationalStatus: 'Maintenance',
        technicalHealth: 'Critical',
        readiness: 'MaintenanceRequired',
        batteryLevel: 40,
        isAvailable: false,
        technicalEligibility: 'CRITICAL',
      },
    ],
    site: { status: 'PASS' },
    personnel: { status: 'PASS' },
    uav: { status: 'FAIL' },
    technical: { status: 'FAIL' },
    createdAt: '2026-11-27T01:30:00Z',
    ...overrides,
  };
}

function setupWorkspace(reEvaluateResult?: ReturnType<typeof of> | ReturnType<typeof throwError>) {
  const api = {
    get: vi.fn(() => of(makeAssessment())),
    getRegionTowers: vi.fn(() => of([])),
    reEvaluate: vi.fn(() => reEvaluateResult ?? of(makeAssessment({ status: 'Ready' }))),
    cancel: vi.fn(() => of(makeAssessment({ status: 'Cancelled' }))),
    getRealtimeWeather: vi.fn(() =>
      of({
        temperatureC: 30,
        humidityPercent: 65,
        windSpeedMs: 3,
        windGustMs: 5,
        windDirectionDeg: 180,
        weatherCode: 1,
        observedAt: '2026-11-27T01:00:00Z',
        source: 'Synthetic weather',
        stationLabel: 'Trạm thử nghiệm',
        isSafeToFly: true,
        warningLevel: 'low',
      }),
    ),
  };

  TestBed.configureTestingModule({
    imports: [AssessmentWorkspace],
    providers: [
      provideRouter([]),
      { provide: PreMissionApi, useValue: api },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: convertToParamMap({ id: ID }), queryParamMap: convertToParamMap({}) } },
      },
      {
        provide: Auth,
        useValue: {
          user: signal({
            id: 'mgr-1',
            email: 'mgr@syn.local',
            fullName: 'Manager Synthetic',
            role: 'Manager',
            mustChangePassword: false,
          }),
        },
      },
      {
        provide: NotificationsRealtime,
        useValue: {
          assessmentEvents$: new Subject(),
          joinAssessment: vi.fn(),
          leaveAssessment: vi.fn(),
        },
      },
    ],
  });

  const fixture = TestBed.createComponent(AssessmentWorkspace);
  fixture.detectChanges();
  return { fixture, api };
}

describe('AssessmentWorkspace Acceptance (FE-REQ-101)', () => {
  it('FR-003: removes BIST/FC tab and modal completely from MF01 workspace and links MaintenanceRequired drones to Drone Detail', () => {
    const { fixture } = setupWorkspace();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="tab-technical"]')).toBeNull();
    expect(el.querySelector('[data-testid="bist-manual-form"]')).toBeNull();
    expect(el.querySelector('[data-testid="fc-connect-btn"]')).toBeNull();

    // Chuyển sang tab UAV để kiểm tra nhãn trạng thái & link tới Chi tiết Drone
    const uavTabBtn = el.querySelector<HTMLButtonElement>('[data-testid="tab-uav"]');
    expect(uavTabBtn).not.toBeNull();
    uavTabBtn!.click();
    fixture.detectChanges();

    expect(el.textContent).toContain('Đạt chuẩn / Sẵn sàng');
    expect(el.textContent).toContain('Không đạt / Cần bảo trì');
    const detailLink = el.querySelector<HTMLAnchorElement>('a[href="/drones/d-maint"]');
    expect(detailLink).not.toBeNull();
  });

  it('FR-004, FR-005 & HC-03: shows 3-role headcount summary, UTC+7 timestamps, and zero "N/A"', () => {
    const { fixture, api } = setupWorkspace();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.textContent).not.toContain('N/A');
    // 2026-11-28T01:00:00Z = 28/11/2026 08:00 UTC+7
    expect(el.textContent).toContain('28/11/2026 08:00');

    const personnelTabBtn = el.querySelector<HTMLButtonElement>('[data-testid="tab-personnel"]');
    expect(personnelTabBtn).not.toBeNull();
    personnelTabBtn!.click();
    fixture.detectChanges();

    const headcountEl = el.querySelector('[data-testid="role-headcount-summary"]');
    expect(headcountEl).not.toBeNull();
    expect(headcountEl!.textContent).toContain('2');
    expect(headcountEl!.textContent).toContain('1');

    const inspectorInput = el.querySelector<HTMLInputElement>('#workspaceInspectorCount');
    const analystInput = el.querySelector<HTMLInputElement>('#workspaceAnalystCount');
    const technicianInput = el.querySelector<HTMLInputElement>('#workspaceTechnicianCount');
    expect(inspectorInput).not.toBeNull();
    expect(analystInput).not.toBeNull();
    expect(technicianInput).not.toBeNull();
    expect(el.querySelector('[name="userId"]')).toBeNull();

    inspectorInput!.value = '3';
    inspectorInput!.dispatchEvent(new Event('input'));
    analystInput!.value = '2';
    analystInput!.dispatchEvent(new Event('input'));
    technicianInput!.value = '1';
    technicianInput!.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    el.querySelector<HTMLButtonElement>('[data-testid="re-evaluate-btn"]')!.click();
    fixture.detectChanges();
    expect(api.reEvaluate).toHaveBeenCalledWith(ID, {
      inspectorCount: 3,
      analystCount: 2,
      technicianCount: 1,
    });
  });

  it('FR-006: displays accessible role="alert" when re-evaluate fails with 409 DRONE_NOT_READY', () => {
    const { fixture } = setupWorkspace(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { errorCode: 'DRONE_NOT_READY', message: 'DRONE_NOT_READY: raw-trace' },
          }),
      ),
    );
    const el = fixture.nativeElement as HTMLElement;
    const reEvalBtn = el.querySelector<HTMLButtonElement>('[data-testid="re-evaluate-btn"]');
    expect(reEvalBtn).not.toBeNull();
    reEvalBtn!.click();
    fixture.detectChanges();

    const alertEl = el.querySelector('[role="alert"]');
    expect(alertEl).not.toBeNull();
    expect(alertEl!.textContent).not.toContain('raw-trace');
    expect(el.querySelector<HTMLInputElement>('#workspaceInspectorCount')!.value).toBe('2');
  });
});
