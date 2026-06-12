// Pylon design + project fixtures — built verbatim from the example
// objects in the official API docs (app.getpylon.com/docs/api, captured
// 2026-06-12). The account behind PYLON_API_KEY had zero designs at
// build time, so these documented payloads are the contract under test.

/** Flat-unwrapped design (what fetchPylonSolarDesign resolves). */
export const PYLON_DESIGN_FIXTURE: Record<string, unknown> = {
  id: 'RnlPy9NMNr',
  title: '13.5kWh Battery storage with 4.99kW Inverter',
  label: null,
  is_primary: true,
  summary: {
    dc_output_kw: 6.49,
    storage_kwh: 13.5,
    description: '6.49kW REC + 13.5kWh storage',
    web_proposal_url: 'https://app.getpylon.com/proposals/GOAn41FTYY',
    pdf_proposal_url: 'https://app.getpylon.com/proposal/rukSigcyTR/RnlPy9NMNr/pdf',
    digital_handover_url: 'https://app.getpylon.com/handover/design/RnlPy9NMNr',
    user_manual_url: null,
    pv_site_information_url:
      'https://app.getpylon.com/siteplans/new/rukSigcyTR/RnlPy9NMNr/siteplan.pdf',
    single_line_diagram_pdf_url: 'https://app.getpylon.com/proposals/GOAn41FTYY/_/sld.pdf',
    latest_snapshot_url: 'https://static.getpylon.com/images/designs/1599550073.jpeg',
  },
  locale: {
    au: {
      stc_quantity: 103,
      stc_value: 0,
      battery_stc_quantity: null,
      battery_stc_value: null,
      prc_quantity: null,
      prc_value: null,
      veec_quantity: null,
      veec_value: null,
    },
  },
  module_types: [
    {
      sku: '779db75d-436a-5631-ba68-5eea5e3d25e2',
      description: 'REC Solar TwinPeak 2 Series',
      quantity: 22,
      type_url: 'https://api.getpylon.com/v1/solar_modules/779db75d-436a-5631-ba68-5eea5e3d25e2',
    },
  ],
  material_types: [],
  inverter_types: [
    {
      sku: 'cb532cd0-a5d4-5b77-a0e3-9a8dd27690f7',
      description: 'Sungrow Power Sun Access SH5K',
      quantity: 1,
      type_url: 'https://api.getpylon.com/v1/solar_inverters/cb532cd0-a5d4-5b77-a0e3-9a8dd27690f7',
    },
  ],
  storage_types: [
    {
      sku: '56f5e7f0-4fb3-5ceb-8e8e-2f1be9dcdb0e',
      description: 'Sonnen Eco 8.10',
      quantity: 1,
      type_url: 'https://api.getpylon.com/v1/solar_batteries/56f5e7f0-4fb3-5ceb-8e8e-2f1be9dcdb0e',
    },
  ],
  heat_pump_types: [],
  ev_charger_types: [],
  solar_mounting_system_types: [],
  pricing: {
    total: 760000,
    total_includes_tax: true,
    currency: 'aud',
  },
  line_items: [
    {
      key: 'fb123c83a89aba2cbc670c48a2bca2fb',
      included_in_summary_line: 'subtotal',
      description: '13.5kWh Battery storage with 4.99kW Inverter',
      unit_amount: 1120500,
      quantity: null,
      total_amount: 1120500,
      tax_type: 'output',
      tax_rate: 0,
      tax_amount: 0,
      is_line_hidden: false,
      is_amount_hidden: false,
      component_type: null,
      component_id: null,
    },
    {
      key: 'cc7331b1227ea6d7b36d3975004d2e74',
      included_in_summary_line: 'total',
      description: 'STCs',
      unit_amount: -3500,
      quantity: 103,
      total_amount: -360500,
      tax_type: 'au:exempt_expenses',
      tax_rate: null,
      tax_amount: null,
      is_line_hidden: false,
      is_amount_hidden: false,
      component_type: null,
      component_id: null,
    },
  ],
  proposal_quote: {
    currency: 'aud',
    total_tax_formatted: '$0.00',
    total_price_formatted: '$7,600.00',
    deposit_amount_formatted: '$760.00',
    financed_amount_formatted: '$5,000.00',
    amount_payable_formatted: '$1,840.00',
    estimated_total_repayments_formatted: '$5,801.04',
    locale_au: {
      eligible_for_stcs: true,
      stc_quantity: 103,
      stc_value_formatted: '$0.00',
      battery_stc_quantity: null,
      battery_stc_value_formatted: null,
      eligible_for_lgcs: false,
    },
  },
  created_at: '2020-02-18T13:14:00+00:00',
  updated_at: '2020-02-18T16:09:40+00:00',
  relationships: {
    project: {
      data: { type: 'solar_projects', id: 'rukSigcyTR' },
      links: { related: 'https://api.getpylon.com/v1/solar_projects/rukSigcyTR' },
    },
  },
}

/** Flat-unwrapped solar_project (what fetchPylonSolarProject resolves). */
export const PYLON_PROJECT_FIXTURE: Record<string, unknown> = {
  id: 'rukSigcyTR',
  reference_number: 'PYL-0003-7789',
  site_location: [145.0709934, -37.8510383],
  site_country_code: null,
  site_address: {
    line1: '19 Parmesan Avenue',
    line2: '',
    city: 'Glen Iris',
    state: 'Victoria',
    zip: '3147',
    country: 'Australia',
  },
  customer_details: {
    name: 'Hubert J. Farnsworth',
    phone: '+61400000000',
    email: 'hubert@example.com',
  },
  site_details: {
    roof_type: 'tile',
    number_of_storeys: 1,
    power_phases: 'one',
    building_classification: 'residential',
    nmi: '6001000000',
    meter_number: null,
    energy_retailer: 'AGL',
    energy_distributor: 'United Energy',
    dnsp_preapproval_number: null,
    mpan: null,
  },
  acceptance: {
    is_accepted: false,
    manually_sold: false,
    latest_esignature: false,
    latest_esignature_pdf_url: null,
  },
  job_sheet_url: null,
  is_committed: true,
  is_archived: false,
  is_example: false,
  created_at: '2020-02-18T13:10:00+00:00',
  updated_at: '2020-02-18T16:09:40+00:00',
  relationships: {},
}
