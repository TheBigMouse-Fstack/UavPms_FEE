import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Auth } from '../../../../core/auth/auth';
import { PreMissionAssessment, UavCandidate } from '../../../../models/pre-mission.models';
import { NotificationsRealtime } from '../../../notifications/data-access/notifications-realtime';
import { normalizeAssessment, PreMissionApi } from '../../data-access/pre-mission-api';
import { AssessmentWorkspace } from './assessment-workspace';

const ID = '11111111-1111-4111-8111-111111111111';

const drone = (overrides: Partial<UavCandidate> = {}): UavCandidate => ({
  id: 'd1',
  candidateId: 'c1',
  code: 'UAV-01',
  model: 'M300',
  isEligible: false,
  operationalStatus: 'Available',
  technicalHealth: 'Unknown',
  readiness: 'MaintenanceRequired',
  batteryLevel: 90,
  reasonCode: 'NO_VALID_TECHNICAL_INSPECTION',
  isAvailable: true,
  technicalEligibility: 'REQUIRES_INSPECTION',
  ...overrides,
});

const assessment = (): PreMissionAssessment => ({
  id: ID,
  assessmentCode: 'PMA-1',
  managerId: 'm1',
  regionId: '',
  regionName: 'Khu vực thử nghiệm',
  plannedStart: '2099-01-01T01:00:00Z',
  plannedEnd: '2099-01-01T05:00:00Z',
  status: 'NotReady',
  overallTechnicalHealth: 'Unknown',
  siteFeasibilityStatus: 'Passed',
  validUntil: '2099-01-01T00:00:00Z',
  version: 1,
  findings: '',
  completedMissionId: null,
  towers: [],
  personnelCandidates: [],
  uavCandidates: [
    drone(),
    drone({ id: 'd2', code: 'UAV-02', isEligible: true, readiness: 'Ready', reasonCode: null, technicalEligibility: 'ELIGIBLE' }),
  ],
  site: { status: 'PASS' },
  personnel: { status: 'PASS' },
  uav: { status: 'FAIL' },
  technical: { status: 'FAIL' },
  createdAt: '2026-10-01T00:00:00Z',
});

describe('AssessmentWorkspace unit & local GIS', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let role: string;

  const create = () => {
    api = {
      get: vi.fn(() => of(assessment())),
      getRegionTowers: vi.fn(() => of([])),
      reEvaluate: vi.fn(() => of(assessment())),
      cancel: vi.fn(),
    };
    TestBed.configureTestingModule({
      imports: [AssessmentWorkspace],
      providers: [
        provideRouter([]),
        { provide: PreMissionApi, useValue: api },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: ID }), queryParamMap: convertToParamMap({}) } } },
        { provide: Auth, useValue: { user: signal({ id: 'u1', email: 'syn@test.local', fullName: 'Synthetic User', role, mustChangePassword: false }) } },
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
    TestBed.overrideComponent(AssessmentWorkspace, { set: { template: '' } });
    const fixture = TestBed.createComponent(AssessmentWorkspace);
    return fixture.componentInstance as unknown as Record<string, (...args: unknown[]) => unknown>;
  };

  beforeEach(() => {
    role = 'Manager';
  });

  it('BRL-01: chỉ hiển thị ứng viên cùng vùng khi DTO cung cấp vùng', () => {
    const result = normalizeAssessment({
      regionId: 'r1',
      droneCandidates: [
        { droneId: 'syn-local', assignedRegionId: 'r1' },
        { droneId: 'syn-other', regionId: 'r2' },
      ],
    });
    expect(result.uavCandidates.map((candidate) => candidate.id)).toEqual(['syn-local']);
  });

  it('BRL-03: không gửi droneIds và thay danh sách cũ bằng danh sách rỗng từ backend', () => {
    const c = create();
    api['reEvaluate'].mockReturnValue(of(normalizeAssessment({
      id: ID,
      droneCandidates: [],
      uavCandidates: [{ droneId: 'syn-stale' }],
    })));
    c['reevaluate']();
    expect(api['reEvaluate']).toHaveBeenCalledWith(ID, {
      inspectorCount: 1, analystCount: 1, technicianCount: 1,
    });
    expect((c['item']() as PreMissionAssessment).uavCandidates).toEqual([]);
  });

  it('counts the UAVs needing maintenance and labels the reason in Vietnamese', () => {
    const c = create();
    expect((c['uavNeedingInspectionCount'] as unknown as () => number)()).toBe(1);
    expect(c['uavReason']('NO_VALID_TECHNICAL_INSPECTION')).toContain('kiểm định');
  });

  it('correctly parses candidate findings JSON and falls back for plain text', () => {
    const c = create() as unknown as {
      parseFindings: (findings: string, role?: string) => {
        isJson: boolean;
        inScope: boolean;
        isActive: boolean;
        hasValidRole: boolean;
        hasInspectorRole: boolean;
        hasBookingConflict: boolean;
        rawText?: string;
      };
    };
    const jsonFindings = JSON.stringify({
      role: 'Inspector',
      userId: 'u-1',
      fullName: 'Synthetic Inspector',
      inScope: true,
      isActive: true,
      hasValidRole: true,
      hasInspectorRole: true,
      hasBookingConflict: false,
    });

    const parsedJson = c.parseFindings(jsonFindings, 'INSPECTOR');
    expect(parsedJson.isJson).toBe(true);
    expect(parsedJson.inScope).toBe(true);
    expect(parsedJson.isActive).toBe(true);
    expect(parsedJson.hasValidRole).toBe(true);
    expect(parsedJson.hasInspectorRole).toBe(true);
    expect(parsedJson.hasBookingConflict).toBe(false);

    const parsedEmpty = c.parseFindings('', 'TECHNICIAN');
    expect(parsedEmpty.isJson).toBe(false);
    expect(parsedEmpty.inScope).toBe(true);
    expect(parsedEmpty.hasInspectorRole).toBe(false);

    const parsedPlainText = c.parseFindings('Đạt yêu cầu vận hành', 'TECHNICIAN');
    expect(parsedPlainText.isJson).toBe(false);
    expect(parsedPlainText.rawText).toBe('Đạt yêu cầu vận hành');
  });

  it('switches local GIS mode and falls back to schematic safely without online tiles', () => {
    const c = create();
    const currentMapType = c['currentMapType'] as unknown as () => 'pmtiles' | 'schematic';
    expect(currentMapType()).toBe('pmtiles');

    c['setMapType']('schematic');
    expect(currentMapType()).toBe('schematic');

    c['setMapType']('pmtiles');
    expect(currentMapType()).toBe('pmtiles');

    c['handleSchematicFallback']();
    expect(currentMapType()).toBe('schematic');
  });

  it('filters malformed scope tower coordinates safely and switches to schematic outside EVNSPC coverage', () => {
    const c = create();
    const itemSignal = c['item'] as unknown as { set: (v: PreMissionAssessment) => void };
    const regionTowersSignal = c['regionTowers'] as unknown as {
      set: (v: readonly { id: string; towerCode: string; latitude: number; longitude: number }[]) => void;
    };
    const currentMapType = c['currentMapType'] as unknown as () => 'pmtiles' | 'schematic';

    itemSignal.set({
      ...assessment(),
      towers: [
        { id: 'at-1', towerId: 'syn-1', towerCode: 'SYN-01', sequence: 1 },
        { id: 'at-2', towerId: 'bad-nan', towerCode: 'BAD-NAN', sequence: 2 },
        { id: 'at-3', towerId: 'bad-range', towerCode: 'BAD-RANGE', sequence: 3 },
        { id: 'at-4', towerId: 'syn-north', towerCode: 'SYN-N2', sequence: 4 },
      ],
    });
    regionTowersSignal.set([
      { id: 'syn-1', towerCode: 'SYN-01', latitude: 10.5, longitude: 106.5 },
      { id: 'bad-nan', towerCode: 'BAD-NAN', latitude: Number.NaN, longitude: 106.5 },
      { id: 'bad-range', towerCode: 'BAD-RANGE', latitude: -95, longitude: 106.5 },
      { id: 'syn-north', towerCode: 'SYN-N2', latitude: 21.25, longitude: 105.75 },
    ]);

    const validTowers = c['getValidScopeTowers']() as { towerId: string }[];
    expect(validTowers.map((t) => t.towerId)).toEqual(['syn-1', 'syn-north']);

    c['setMapType']('pmtiles');
    c['renderScopeOnMap']();
    expect(currentMapType()).toBe('schematic');
  });

  it('creates workspace scope pin elements using textContent without HTML injection', () => {
    const c = create();
    const el = c['createScopePinElement'](1, '<script>alert(1)</script>', true, false) as HTMLDivElement;
    expect(el.querySelector('script')).toBeNull();
    expect(el.textContent).toContain('1. <script>alert(1)</script> (Bắt đầu)');
  });
});
