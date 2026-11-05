/** Redacted regression fixture from EST-0018. These are the incident's stored
 * charges, not an approved installation price or a proposed replacement quote. */
export const evIncidentTier = {
  label: 'Install + switchboard health check (recommended)',
  subtotal_ex_gst: 801,
  line_items: [
    { description: 'Install 32A three-phase outlet - new dedicated circuit, 3-phase RCBO and certification', source: 'assembly:5b48eed9-3f37-4d1c-a3e2-d4afae0a5e32', quantity: 1, unit: 'each', unit_price_ex_gst: 156, total_ex_gst: 156 },
    { description: 'Install labour - run circuit, mount and terminate EV charger, test and certify', source: 'labour', quantity: 3, unit: 'hr', unit_price_ex_gst: 150, total_ex_gst: 450 },
    { description: 'Switchboard health check + load assessment (confirm spare capacity for EV load)', source: 'labour', quantity: 1, unit: 'each', unit_price_ex_gst: 150, total_ex_gst: 150 },
    { description: 'Risk allowance - unconfirmed switchboard capacity / load verification', source: 'labour', quantity: 0.3, unit: 'hr', unit_price_ex_gst: 150, total_ex_gst: 45 },
  ],
}

export const evIncidentScope = 'Supply and install a 7kW three-phase EV charger at the parking spot approximately 6m from the switchboard. Work includes a new dedicated 32A three-phase circuit with 3-phase RCBO, termination, isolation and certification.'
export const evIncidentAssumptions = [
  'Property is already on three-phase supply (as advised by customer).',
  'Charger unit is supplied by us; the specific 7kW three-phase model and its price are confirmed separately as no catalogue price is held for the unit.',
  'Charger unit supplied separately — model and price confirmed before booking.',
]
export const evIncidentUpsells = [
  { name: 'Add RCBO safety switch', price_ex_gst: 95 },
  { name: 'Switchboard health check', price_ex_gst: 150 },
]
