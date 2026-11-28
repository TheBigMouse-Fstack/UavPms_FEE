import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../../../environments/environment';
import { PreMissionApi } from './pre-mission-api';

const ID = '11111111-1111-4111-8111-111111111111';
const URL = `${environment.apiBaseUrl}/pre-mission-assessments`;

const assessmentDto = (droneCandidates: unknown[] = [], overrides: Record<string, unknown> = {}) => ({
  id: ID,
  assessmentCode: 'PMA-1',
  status: 'Ready',
  plannedStart: '2099-01-01T01:00:00Z',
  plannedEnd: '2099-01-01T05:00:00Z',
  createdAt: '2026-11-27T01:00:00Z',
  inspectorCount: 2,
  analystCount: 1,
  technicianCount: 1,
  personnelCandidates: [],
  droneCandidates,
  ...overrides,
});

describe('PreMissionApi (FE-REQ-101)', () => {
  let api: PreMissionApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(PreMissionApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('sends inspectorCount, analystCount, technicianCount and droneIds on POST /pre-mission-assessments', () => {
    api
      .create({
        regionId: 'r1',
        plannedStart: '2099-01-01T08:00',
        plannedEnd: '2099-01-01T10:00',
        towerIds: ['t1'],
        inspectorCount: 2,
        analystCount: 1,
        technicianCount: 3,
        droneIds: ['d-ready-1'],
        idempotencyKey: 'k1',
      })
      .subscribe();

    const req = http.expectOne(URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.inspectorCount).toBe(2);
    expect(req.request.body.analystCount).toBe(1);
    expect(req.request.body.technicianCount).toBe(3);
    expect(req.request.body.droneIds).toEqual(['d-ready-1']);
    expect(req.request.body.plannedStart).toMatch(/Z$/);
    expect(new Date(req.request.body.plannedStart).getTime()).toBe(new Date('2099-01-01T08:00').getTime());
    req.flush(assessmentDto());
  });

  it('refreshes assessment with POST /{id}/re-evaluate and forwards optional headcount/droneIds payload', () => {
    let status = '';
    api
      .reEvaluate(ID, {
        inspectorCount: 2,
        analystCount: 2,
        technicianCount: 1,
        droneIds: ['d-ready-1'],
      })
      .subscribe((a) => (status = a.status));

    const req = http.expectOne(`${URL}/${ID}/re-evaluate`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      inspectorCount: 2,
      analystCount: 2,
      technicianCount: 1,
      droneIds: ['d-ready-1'],
    });
    req.flush(assessmentDto());
    expect(status).toBe('Ready');
  });

  it('propagates 400 INVALID_ROLE_HEADCOUNT, 403, and both 409 drone errors cleanly', () => {
    let code400 = '';
    api
      .create({
        regionId: 'r1',
        plannedStart: '2099-01-01T08:00',
        plannedEnd: '2099-01-01T10:00',
        towerIds: ['t1'],
        inspectorCount: 0,
        analystCount: 1,
        technicianCount: 1,
        droneIds: ['d1'],
      })
      .subscribe({
        error: (err: HttpErrorResponse) => {
          code400 = err.error?.errorCode ?? '';
        },
      });

    http.expectOne(URL).flush({ errorCode: 'INVALID_ROLE_HEADCOUNT' }, { status: 400, statusText: 'Bad Request' });
    expect(code400).toBe('INVALID_ROLE_HEADCOUNT');

    let code409 = '';
    api
      .create({
        regionId: 'r1',
        plannedStart: '2099-01-01T08:00',
        plannedEnd: '2099-01-01T10:00',
        towerIds: ['t1'],
        inspectorCount: 1,
        analystCount: 1,
        technicianCount: 1,
        droneIds: ['d-not-ready'],
      })
      .subscribe({
        error: (err: HttpErrorResponse) => {
          code409 = err.error?.errorCode ?? '';
        },
      });

    http.expectOne(URL).flush({ errorCode: 'DRONE_NOT_READY' }, { status: 409, statusText: 'Conflict' });
    expect(code409).toBe('DRONE_NOT_READY');

    let mismatchCode = '';
    api.reEvaluate(ID, { droneIds: ['d-other-region'] }).subscribe({
      error: (err: HttpErrorResponse) => {
        mismatchCode = err.error?.errorCode ?? '';
      },
    });
    http
      .expectOne(`${URL}/${ID}/re-evaluate`)
      .flush({ errorCode: 'DRONE_REGION_MISMATCH' }, { status: 409, statusText: 'Conflict' });
    expect(mismatchCode).toBe('DRONE_REGION_MISMATCH');

    let forbiddenStatus = 0;
    api.reEvaluate(ID).subscribe({
      error: (err: HttpErrorResponse) => {
        forbiddenStatus = err.status;
      },
    });
    http.expectOne(`${URL}/${ID}/re-evaluate`).flush({}, { status: 403, statusText: 'Forbidden' });
    expect(forbiddenStatus).toBe(403);
  });

  it('fetches selectable drones, filters exact region, and maps readiness to Ready or MaintenanceRequired', () => {
    let drones: readonly { id: string; readiness: string }[] = [];
    api.getRegionDrones('r1').subscribe((list) => {
      drones = list.map((d) => ({ id: d.id, readiness: d.readiness }));
    });

    const req = http.expectOne((r) => r.url === `${environment.apiBaseUrl}/drones`);
    expect(req.request.params.get('detailed')).toBe('true');
    expect(req.request.params.get('regionId')).toBe('r1');
    req.flush([
      { id: 'd-1', regionId: 'r1', code: 'UAV-01', name: 'Ready Drone', model: 'M300', technicalHealth: 'Healthy', operationalStatus: 'Available' },
      { id: 'd-2', regionId: 'r1', code: 'UAV-02', name: 'Maint Drone', model: 'M300', technicalHealth: 'Critical', operationalStatus: 'Maintenance' },
      { id: 'd-3', regionId: 'r2', code: 'UAV-03', name: 'Other Region', model: 'M300', technicalHealth: 'Healthy', operationalStatus: 'Available' },
    ]);

    expect(drones).toEqual([
      { id: 'd-1', readiness: 'Ready' },
      { id: 'd-2', readiness: 'MaintenanceRequired' },
    ]);
  });

  it('sorts assessment list newest-first (DESC) by createdAt', () => {
    let ids: string[] = [];
    api.list({ page: 1, pageSize: 10 }).subscribe((res) => {
      ids = res.items.map((item) => item.id);
    });

    const req = http.expectOne((r) => r.url === URL && r.params.get('page') === '1');
    req.flush([
      assessmentDto([], { id: 'a-old', createdAt: '2026-11-20T01:00:00Z' }),
      assessmentDto([], { id: 'a-new', createdAt: '2026-11-27T08:00:00Z' }),
    ]);

    expect(ids).toEqual(['a-new', 'a-old']);
  });

  it('derives availability and technical eligibility of UAV candidates from reasonCode', () => {
    let drones: { id: string; isAvailable?: boolean; technicalEligibility?: string }[] = [];
    api.get(ID).subscribe((a) => (drones = [...a.uavCandidates]));
    http.expectOne(`${URL}/${ID}`).flush(
      assessmentDto([
        { droneId: 'ok', isEligible: true, operationalStatus: 'Available', technicalHealth: 'Healthy', technicalInspectionId: 'i1' },
        { droneId: 'noinsp', operationalStatus: 'Available', technicalHealth: 'Healthy', reasonCode: 'NO_VALID_TECHNICAL_INSPECTION' },
        { droneId: 'busy', operationalStatus: 'Unavailable', technicalHealth: 'Unknown', reasonCode: 'SCHEDULE_CONFLICT' },
        { droneId: 'scope', operationalStatus: 'Available', technicalHealth: 'Healthy', technicalInspectionId: 'i2', reasonCode: 'SCOPE_EXCEEDS_CAPABILITY', suitability: 'UNSUITABLE' },
      ]),
    );
    const byId = Object.fromEntries(drones.map((d) => [d.id, d]));
    expect(byId['ok']).toMatchObject({ isAvailable: true, technicalEligibility: 'ELIGIBLE' });
    expect(byId['noinsp']).toMatchObject({ isAvailable: true, technicalEligibility: 'REQUIRES_INSPECTION' });
    expect(byId['busy']).toMatchObject({ isAvailable: false, technicalEligibility: 'REQUIRES_INSPECTION' });
    expect(byId['scope']).toMatchObject({ isAvailable: true, technicalEligibility: 'ELIGIBLE' });
  });

  it('sends create-mission with one UAV, required flags, an ISO UTC deadline and trimmed instructions', () => {
    api
      .createMission({
        assessmentId: ID,
        title: 'Kiểm tra tuyến A',
        personnel: [{ userId: 'u1', role: 'INSPECTOR', isRequired: true }],
        droneIds: ['d1'],
        priority: 'NORMAL',
        objective: 'PERIODIC_INSPECTION',
        isImmediate: false,
        idempotencyKey: 'k1',
        confirmationDeadline: '2099-01-01T00:30:00+07:00',
        managerInstructions: '  Mang thêm pin  ',
      })
      .subscribe();
    const req = http.expectOne(`${URL}/${ID}/create-mission`);
    expect(req.request.body.droneIds).toEqual(['d1']);
    expect(req.request.body.personnel[0].isRequired).toBe(true);
    expect(req.request.body.confirmationDeadline).toBe('2098-12-31T17:30:00.000Z');
    expect(req.request.body.managerInstructions).toBe('Mang thêm pin');
    req.flush({ id: 'm1', missionCode: 'MS-1', title: 'x', status: 'PendingAcceptance' });
  });

  it('parses pagination metadata from nested pagination object (totalItems & totalPages)', () => {
    let result: { totalCount: number; totalPages: number; page: number; pageSize: number } | undefined;
    api.list({ page: 1, pageSize: 10 }).subscribe((res) => (result = res));
    const req = http.expectOne((r) => r.url === URL && r.params.get('page') === '1' && r.params.get('pageSize') === '10');
    req.flush({
      data: {
        items: [assessmentDto()],
        pagination: { page: 1, pageSize: 10, totalItems: 35, totalPages: 4 },
      },
    });
    expect(result).toMatchObject({ totalCount: 35, totalPages: 4, page: 1, pageSize: 10 });
  });

  it('parses pagination metadata when pagination sits outside data envelope', () => {
    let result: { totalCount: number; totalPages: number } | undefined;
    api.list({ page: 2, pageSize: 10 }).subscribe((res) => (result = res));
    const req = http.expectOne((r) => r.url === URL && r.params.get('page') === '2');
    req.flush({
      data: [assessmentDto()],
      pagination: { page: 2, pageSize: 10, totalItems: 24, totalPages: 3 },
    });
    expect(result).toMatchObject({ totalCount: 24, totalPages: 3 });
  });

  it('enables next-page navigation with totalKnown=false when backend returns a raw full-page array', () => {
    let result: { totalCount: number; totalPages: number; totalKnown?: boolean; items: readonly unknown[] } | undefined;
    api.list({ page: 1, pageSize: 10 }).subscribe((res) => (result = res));
    const req = http.expectOne((r) => r.url === URL && r.params.get('page') === '1');
    req.flush(Array.from({ length: 10 }, () => assessmentDto()));
    expect(result?.items.length).toBe(10);
    expect(result?.totalCount).toBe(10);
    expect(result?.totalPages).toBe(2);
    expect(result?.totalKnown).toBe(false);
  });

  it('reads X-Total-Count response header when body is a raw array', () => {
    let result: { totalCount: number; totalPages: number; totalKnown?: boolean } | undefined;
    api.list({ page: 1, pageSize: 10 }).subscribe((res) => (result = res));
    const req = http.expectOne((r) => r.url === URL && r.params.get('page') === '1');
    req.flush(Array.from({ length: 10 }, () => assessmentDto()), {
      headers: { 'X-Total-Count': '42' },
    });
    expect(result).toMatchObject({ totalCount: 42, totalPages: 5, totalKnown: true });
  });
});
