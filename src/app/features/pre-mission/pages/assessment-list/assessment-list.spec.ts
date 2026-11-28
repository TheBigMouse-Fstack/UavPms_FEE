import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { Auth } from '../../../../core/auth/auth';
import { ToastService } from '../../../../core/toast/toast.service';
import { AssessmentPage } from '../../../../models/pre-mission.models';
import { NotificationsRealtime } from '../../../notifications/data-access/notifications-realtime';
import { PreMissionApi } from '../../data-access/pre-mission-api';
import { AssessmentList } from './assessment-list';

interface TestPrincipal {
  readonly role?: string;
  readonly roles?: readonly string[];
}

describe('AssessmentList', () => {
  const emptyPage: AssessmentPage = {
    items: [],
    page: 1,
    pageSize: 10,
    totalCount: 0,
    totalPages: 1,
    totalKnown: true,
  };

  const setup = (principal: TestPrincipal): ComponentFixture<AssessmentList> => {
    const api = {
      getRegions: vi.fn(() => of([])),
      list: vi.fn(() => of(emptyPage)),
    };
    const realtime = {
      assessmentEvents$: new Subject(),
      connect: vi.fn(),
      joinAssessmentsList: vi.fn(),
      leaveAssessmentsList: vi.fn(),
    };

    TestBed.configureTestingModule({
      imports: [AssessmentList],
      providers: [
        provideRouter([]),
        { provide: Auth, useValue: { user: signal(principal) } },
        { provide: PreMissionApi, useValue: api },
        { provide: NotificationsRealtime, useValue: realtime },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn() } },
      ],
    });

    const fixture = TestBed.createComponent(AssessmentList);
    fixture.detectChanges();
    return fixture;
  };

  it.each([
    { label: 'SystemAdmin', principal: { role: 'SystemAdmin' } },
    { label: 'Manager', principal: { role: 'Manager' } },
    { label: 'multi-role Manager', principal: { role: 'Inspector', roles: ['Inspector', 'Manager'] } },
  ])('shows the create action for $label', ({ principal }) => {
    const fixture = setup(principal);
    const element = fixture.nativeElement as HTMLElement;
    const createLink = element.querySelector<HTMLAnchorElement>(
      'a[href="/pre-mission/new"]',
    );

    expect(createLink?.textContent?.trim()).toBe('Tạo đánh giá tiền nhiệm vụ');
  });

  it.each(['Inspector', 'Analyst', 'Technician'])(
    'hides the create action for the %s role',
    (role) => {
      const fixture = setup({ role });
      const element = fixture.nativeElement as HTMLElement;

      expect(element.querySelector('a[href="/pre-mission/new"]')).toBeNull();
    },
  );
});
