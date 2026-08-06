(function () {
  const states = [['01','Jammu and Kashmir'],['02','Himachal Pradesh'],['03','Punjab'],['04','Chandigarh'],['05','Uttarakhand'],['06','Haryana'],['07','Delhi'],['08','Rajasthan'],['09','Uttar Pradesh'],['10','Bihar'],['11','Sikkim'],['12','Arunachal Pradesh'],['13','Nagaland'],['14','Manipur'],['15','Mizoram'],['16','Tripura'],['17','Meghalaya'],['18','Assam'],['19','West Bengal'],['20','Jharkhand'],['21','Odisha'],['22','Chhattisgarh'],['23','Madhya Pradesh'],['24','Gujarat'],['26','Dadra and Nagar Haveli and Daman and Diu'],['27','Maharashtra'],['29','Karnataka'],['30','Goa'],['31','Lakshadweep'],['32','Kerala'],['33','Tamil Nadu'],['34','Puducherry'],['35','Andaman and Nicobar Islands'],['36','Telangana'],['37','Andhra Pradesh'],['38','Ladakh']];
  function populate(select, selectedState = '') {
    if (!select) return;
    const current = selectedState || select.value;
    select.innerHTML = '<option value="">Select state / union territory</option>' + states.map(([code, name]) => `<option value="${name}" data-state-code="${code}">${name}</option>`).join('');
    select.value = current;
  }
  function bind(select, codeInput, sacInput) {
    if (!select || !codeInput) return;
    populate(select);
    const sync = () => {
      codeInput.value = select.options[select.selectedIndex]?.dataset.stateCode || '';
      if (sacInput && !sacInput.value.trim()) sacInput.value = '996331';
    };
    select.addEventListener('change', sync);
    select.dataset.syncStateFields = '1';
  }
  window.KMasterIndiaStates = { states, populate, bind };
})();
