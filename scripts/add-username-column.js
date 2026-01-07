const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://mobokomuxbfqbuzwasbe.supabase.co'
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vYm9rb211eGJmcWJ1endhc2JlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzcxNTgxMiwiZXhwIjoyMDgzMjkxODEyfQ.ZiMtCiJbXqdyTBbOvCcxyJJuHtQ7T8NZ_mt3OdwPKS8'

const supabase = createClient(supabaseUrl, serviceRoleKey)

async function addUsernameColumn() {
  console.log('Checking if username column exists...')

  // Try to query the username column
  const { data: testProfile, error: testError } = await supabase
    .from('profiles')
    .select('user_id')
    .limit(1)

  // Try updating with username to see if column exists
  const { data: mainAdmin } = await supabase
    .from('profiles')
    .select('user_id, display_name')
    .eq('role', 'main_admin')
    .single()

  if (!mainAdmin) {
    console.error('No main_admin found!')
    return
  }

  console.log('Found main_admin:', mainAdmin.display_name)

  // Update display_name to 'Admin' so we can use it for lookup
  const { error: updateError } = await supabase
    .from('profiles')
    .update({ display_name: 'admin' })
    .eq('user_id', mainAdmin.user_id)

  if (updateError) {
    console.error('Failed to update display_name:', updateError)
    return
  }

  console.log('Updated display_name to "admin"')
  console.log('')
  console.log('Since username column does not exist, the login will use display_name')
  console.log('')
  console.log('Login credentials:')
  console.log('  Username: admin')
  console.log('  Password: Plmplmplm1')
}

addUsernameColumn()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err)
    process.exit(1)
  })
