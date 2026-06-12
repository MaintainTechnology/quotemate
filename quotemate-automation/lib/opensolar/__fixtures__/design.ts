// Test fixtures for the OpenSolar tab — shaped from the documented
// payload examples (developers.opensolar.com: Projects, Systems Details,
// Proposal Data). Sanitised/synthetic data; structure mirrors the docs.
// Phase 0 against the live org replaces these with captured fixtures.

import { gzipSync } from 'node:zlib'

/** GET /api/orgs/:org/projects/:id/ — project payload (Raw Data plan
 *  carries the compressed design string; built below). */
export const OPENSOLAR_PROJECT_FIXTURE: Record<string, unknown> = {
  id: 3763174,
  identifier: '4007c165-ec25-4c02-ae94-5746c0e22a64',
  address: '6 Hopetoun Ave',
  locality: 'Vaucluse',
  state: 'NSW',
  zip: '2030',
  country_iso2: 'AU',
  lat: -33.857,
  lon: 151.277,
  contacts_data: [
    {
      id: 91,
      first_name: 'Sam',
      family_name: 'Customer',
      email: 'sam@example.com',
      phone: '+61400000000',
    },
  ],
  workflow: { id: 3631398, workflow_id: 84617, active_stage_id: 433194 },
  design: gzipSync(
    Buffer.from(JSON.stringify({ systems: [{ uuid: 'E583FD88' }] }), 'utf8'),
  ).toString('base64'),
}

/** GET …/systems/details/ — per the documented example (AU-ified). */
export const OPENSOLAR_SYSTEM_DETAILS_FIXTURE: Record<string, unknown> = {
  systems: [
    {
      kw_stc: 6.21,
      uuid: 'E583FD88-EB6C-4311-91A9-AC719041EAA8',
      id: 8280,
      name: 'System 1 (6.21 kW)',
      output_annual_kwh: 8547,
      consumption_offset_percentage: 82,
      price_including_tax: 8990,
      price_excluding_tax: 8172.73,
      battery_total_kwh: 0,
      co2_tons_lifetime: 65.96,
      modules: [
        { manufacturer_name: 'LG Electronics Inc.', code: 'LG345N1C-V5', quantity: 18 },
      ],
      total_module_quantity: 18,
      inverters: [{ manufacturer_name: 'Fronius', code: 'Primo 5.0-1', quantity: 1 }],
      batteries: [],
      other_components: [
        { manufacturer_name: 'Hardware Co.', code: 'dc_isolator_xyz', quantity: 1 },
      ],
      adders: [
        { label: 'Switchboard upgrade', total_value: 450, total_cost: 300, show_customer: true, quantity: 1 },
        { label: 'Internal margin', total_value: 0, total_cost: 20, show_customer: false, quantity: 1 },
      ],
      module_groups: [
        { module_quantity: 12, azimuth: 7, slope: 20, layout: 'portrait' },
        { module_quantity: 6, azimuth: 187, slope: 20, layout: 'landscape' },
      ],
      incentives: [
        { paid_to_customer: true, value: 2150, title: '39 STCs — Small-scale Technology Certificates' },
      ],
      data: {},
    },
    {
      kw_stc: 9.9,
      uuid: 'SECOND-SYSTEM-UUID',
      id: 8281,
      name: 'System 2 (9.9 kW)',
      output_annual_kwh: 13400,
      price_including_tax: 12990,
      modules: [{ manufacturer_name: 'Jinko', code: 'JKM440', quantity: 22 }],
      total_module_quantity: 22,
      inverters: [],
      batteries: [],
      other_components: [],
      adders: [],
      module_groups: [{ module_quantity: 22, azimuth: 10, slope: 22, layout: 'portrait' }],
      incentives: [],
      data: {},
    },
  ],
}

/** GET /api/user_logins/?project_ids=… — proposal data (Raw Data plan).
 *  Numerics arrive display-formatted per the docs example. */
export const OPENSOLAR_PROPOSAL_DATA_FIXTURE: unknown = [
  {
    id: 62854,
    country_iso2: 'AU',
    name: 'Demo Solar Co.',
    projects: [
      {
        id: 3763174,
        address: '6 Hopetoun Ave',
        tax_name: 'GST',
        calculation_error_messages: [],
        proposal_data: {
          tax_name: 'GST',
          systems: [
            {
              uuid: 'E583FD88-EB6C-4311-91A9-AC719041EAA8',
              systemKwStc: '6.210',
              systemOutputAnnualkWh: '8,547',
              systemPaybackYear: '4.6',
              systemNetPresentValue: '14,820',
              systemIrr: '21.4',
              systemReturnOnInvestment: '212',
              output_monthly_json:
                '[860, 760, 740, 640, 540, 480, 520, 620, 700, 790, 830, 867]',
              data: {
                pricing: { system_price_including_tax: 8990 },
                line_items: [
                  { description: '18 × LG345N1C-V5 panels', quantity: 18, amount: 4200 },
                  { description: 'Fronius Primo 5.0-1 inverter', quantity: 1, amount: 2100 },
                  { description: 'Installation & balance of system', quantity: 1, amount: 4840 },
                  { description: 'STC incentive (39 certificates)', quantity: 1, amount: -2150 },
                ],
                payment_options: [
                  { title: 'Cash purchase', deposit: 890 },
                ],
                bills: {
                  current: { bill_yearly: 2450 },
                  proposed: { bill_yearly: 441 },
                },
                output: { monthly: [860, 760, 740, 640, 540, 480, 520, 620, 700, 790, 830, 867] },
              },
            },
          ],
        },
      },
    ],
  },
]
